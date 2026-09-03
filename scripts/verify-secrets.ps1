[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [string]$ToolCache
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$gitleaksVersion = "8.30.1"
$archiveName = "gitleaks_${gitleaksVersion}_windows_x64.zip"
$archiveSha256 = "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e"
$downloadUrl = "https://github.com/gitleaks/gitleaks/releases/download/v${gitleaksVersion}/${archiveName}"

if (-not $RepositoryRoot) {
    $RepositoryRoot = Split-Path -Parent $PSScriptRoot
}

if (-not $ToolCache) {
    $cacheRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
    $ToolCache = Join-Path $cacheRoot "neura-security-tools"
}

$resolvedRepository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$toolDirectory = Join-Path $ToolCache "gitleaks-$gitleaksVersion"
$archivePath = Join-Path $toolDirectory $archiveName
$executablePath = Join-Path $toolDirectory "gitleaks.exe"

New-Item -ItemType Directory -Path $toolDirectory -Force | Out-Null

if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archivePath
}

$actualSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $archiveSha256) {
    throw "Gitleaks archive integrity check failed. Expected $archiveSha256; received $actualSha256."
}

Expand-Archive -LiteralPath $archivePath -DestinationPath $toolDirectory -Force
if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
    throw "Verified Gitleaks archive did not contain gitleaks.exe."
}

& $executablePath git $resolvedRepository `
    --log-opts "--all" `
    --no-banner `
    --no-color `
    --redact=100 `
    --timeout 180

$scanExitCode = $LASTEXITCODE
if ($scanExitCode -eq 1) {
    Write-Error `
        -Message "Gitleaks rejected repository history. Review redacted findings locally; never publish secret values." `
        -ErrorId "Neura.SecretLeak" `
        -Category SecurityError `
        -ErrorAction Stop
}
if ($scanExitCode -ne 0) {
    throw "Gitleaks execution failed with exit code $scanExitCode."
}

Write-Output "Neura secrets: Gitleaks $gitleaksVersion scanned complete Git history; no leaks found."
