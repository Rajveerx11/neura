# Local source-linked Mastra development launcher. Not a release/package installer.
param([switch]$Check, [switch]$Development, [string]$BinDirectory = (Join-Path $HOME '.local\bin'))
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath($PSScriptRoot)
if ($repo -match '[^\x20-\x7e]|[%"!&|<>^]') { throw 'Unsupported command-shell characters or non-ASCII source path. Use an ASCII checkout path for this development launcher.' }
$node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$versionText = (& $node.Source --version).Trim()
if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '^v(\d+\.\d+\.\d+)$' -or [version]$Matches[1] -lt [version]'24.15.0') { throw 'Node 24.15+ required; no tools were installed or downgraded.' }
& $node.Source (Join-Path $repo 'src\cli.ts') --check
if ($LASTEXITCODE -ne 0) { throw 'Mastra source prerequisite check failed.' }
$destination = Join-Path ([IO.Path]::GetFullPath($BinDirectory)) 'neura.cmd'
$content = "@echo off`r`nsetlocal`r`nset `"NEURA_SOURCE=$repo`"`r`ncall `"%NEURA_SOURCE%\launcher\neura.cmd`" %*`r`nexit /b %ERRORLEVEL%`r`n"
function Assert-Real([string]$value) {
    for ($current = [IO.Path]::GetFullPath($value); $current; $current = Split-Path -Parent $current) {
        if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked launcher paths refused.' }
        if ((Split-Path -Parent $current) -eq $current) { break }
    }
}
Assert-Real $destination
if ($Check) {
    if (-not (Test-Path -LiteralPath $destination) -or [IO.File]::ReadAllText($destination) -cne $content) { throw 'Installed launcher is absent or differs from this Mastra source checkout. Check does not install or overwrite it.' }
    Write-Output 'Mastra development launcher matches this source checkout. No Pi runtime is invoked. This is not a full managed-runtime/live attestation.'
    exit 0
}
if (-not $Development) { throw 'Distribution remains gated by dependency/license review. Use -Development only for local development/testing; this is not production or redistribution clearance.' }
$backup = $null
if (Test-Path -LiteralPath $destination) {
    $existing = [IO.File]::ReadAllText($destination)
    if ($existing -ceq $content) { Write-Output 'Mastra development launcher already matches.'; exit 0 }
    # Only replace the legacy receipt-owned launcher. Unknown/user-edited launchers stay untouched.
    $receiptPath = Join-Path $HOME '.pi\agent\neura\.install-state.json'
    if (-not (Test-Path -LiteralPath $receiptPath)) { throw 'Existing launcher has no legacy ownership receipt; refusing overwrite.' }
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    $expected = $receipt.files.'launcher/neura.cmd'
    if (-not $expected -or (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Existing launcher differs from legacy ownership receipt; preserved.' }
    $backup = $destination + '.pi-backup-' + [Guid]::NewGuid().ToString()
    Copy-Item -LiteralPath $destination -Destination $backup
}
New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
Assert-Real $destination
$temp = $destination + '.staging-' + [Guid]::NewGuid().ToString()
try {
    [IO.File]::WriteAllText($temp, $content, [Text.Encoding]::ASCII)
    # Recheck after staging before replacing a human-owned destination.
    Assert-Real $destination
    if ($backup -and (Get-FileHash -LiteralPath $destination).Hash -ne (Get-FileHash -LiteralPath $backup).Hash) { throw 'Launcher changed while staging; replacement refused.' }
    if (-not $backup -and (Test-Path -LiteralPath $destination)) { throw 'Launcher appeared while staging; replacement refused.' }
    Move-Item -LiteralPath $temp -Destination $destination -Force
} finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp } }
Write-Output 'Installed source-linked Mastra development launcher; credentials/history and standalone Pi were not touched.'
if ($backup) { Write-Output "Legacy launcher backup: $backup" }
Write-Output 'Run neura --help. Close Pi agents before running scripts/retire-pi-neura.ps1 -Apply.'
