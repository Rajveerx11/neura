# Reversible retirement of receipt-owned legacy Neura files, never a Pi profile wipe.
param([switch]$Apply, [string]$ProfileRoot = (Join-Path $HOME '.pi\agent'), [string]$BackupRoot)
$ErrorActionPreference = 'Stop'
function Assert-RealPath([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked cleanup paths are refused.' }
        }
        $parent = Split-Path -Parent $current
        if ($parent -eq $current) { break }
        $current = $parent
    }
}
Assert-RealPath $ProfileRoot
$receiptPath = Join-Path $ProfileRoot 'neura\.install-state.json'
if (-not (Test-Path -LiteralPath $receiptPath)) { Write-Output 'No legacy Neura receipt; no files retired.'; exit 0 }
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
if ($receipt.schemaVersion -ne 1 -or -not $receipt.files) { throw 'Invalid legacy Neura receipt; cleanup refused.' }
$matching = @(); $preserved = 0
foreach ($property in $receipt.files.PSObject.Properties) {
    $name = $property.Name
    if ($name -notmatch '^(agent/(extensions|themes|neura)/[\w.@/-]+|agent/mcp\.json|launcher/neura\.cmd)$' -or $name -match '(^|/)\.\.(/|$)' -or $property.Value -notmatch '^[a-f0-9]{64}$') { throw 'Unsafe legacy receipt path/hash; cleanup refused.' }
    if ($name -match '(?i)(^|/)(sessions|approvals|memory|auth|credentials)(/|\.)|learn-vault\.json$|settings\.json$') { $preserved++; continue }
    $source = if ($name -eq 'launcher/neura.cmd') { Join-Path $HOME '.local\bin\neura.cmd' } else { Join-Path $ProfileRoot $name.Substring(6) }
    Assert-RealPath $source
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $property.Value) { $preserved++; continue }
    $matching += [pscustomobject]@{ Name = $name; Source = $source; Hash = $property.Value }
}
# Match process identity in memory only; never emit/persist command lines or read token/log/session files.
$running = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|pi)(\.exe)?$' -and $_.CommandLine -match 'pi-coding-agent|[/\\]pi[/\\]|pi-launcher\.js' }).Count
Write-Output "Receipt-matched legacy files: $($matching.Count); modified/private files preserved: $preserved; active Pi processes: $running"
if (-not $Apply) { Write-Output 'Read-only inventory. Use -Apply only after all Pi agents have exited. No credentials or user data will be removed.'; exit 0 }
if ($running -gt 0) { throw 'Legacy cleanup blocked: Pi agents are active. Nothing was moved.' }
if (-not $BackupRoot) { $BackupRoot = Join-Path $HOME ('.neura\legacy-backups\' + [Guid]::NewGuid().ToString()) }
$backup = [IO.Path]::GetFullPath($BackupRoot)
if (Test-Path -LiteralPath $backup) { throw 'Backup destination must not exist.' }
Assert-RealPath $backup
New-Item -ItemType Directory -Path $backup | Out-Null
$journal = Join-Path $backup 'retirement.jsonl'
foreach ($entry in $matching) {
    Assert-RealPath $entry.Source
    if ((Get-FileHash -LiteralPath $entry.Source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Hash) { throw 'A legacy file changed during cleanup. Earlier moves remain recorded for recovery.' }
    $destination = Join-Path $backup $entry.Name
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    # Journal intent before moving; an interrupted cleanup is recoverable without deleting anything.
    @{ source = $entry.Source; backup = $destination; sha256 = $entry.Hash } | ConvertTo-Json -Compress | Add-Content -LiteralPath $journal
    Move-Item -LiteralPath $entry.Source -Destination $destination
}
Copy-Item -LiteralPath $receiptPath -Destination (Join-Path $backup 'legacy-install-receipt.json')
Write-Output "Retired $($matching.Count) matched files reversibly. Backup: $backup"
Write-Output 'Standalone Pi, settings, credentials, memory, approvals, history, vaults and unmatched files were preserved. No global package was uninstalled.'
