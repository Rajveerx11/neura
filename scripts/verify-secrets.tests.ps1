[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scanScript = Join-Path $PSScriptRoot "verify-secrets.ps1"
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot = Join-Path $tempRoot ("neura-secret-tests-" + [guid]::NewGuid().ToString("N"))
$toolCache = Join-Path $testRoot "tools"

function New-TestRepository([string]$Name) {
    $repository = Join-Path $testRoot $Name
    New-Item -ItemType Directory -Path $repository -Force | Out-Null
    git -C $repository init --quiet
    if ($LASTEXITCODE -ne 0) { throw "Could not initialize secret-scan test repository." }
    git -C $repository config user.name "Neura Tests"
    git -C $repository config user.email "neura-tests@example.invalid"
    return $repository
}

function Commit-TestFile([string]$Repository, [string]$Name, [string]$Value) {
    [IO.File]::WriteAllText((Join-Path $Repository $Name), $Value, [Text.UTF8Encoding]::new($false))
    git -C $Repository -c core.hooksPath=NUL add -- $Name
    git -C $Repository -c core.hooksPath=NUL commit --quiet -m "test fixture"
    if ($LASTEXITCODE -ne 0) { throw "Could not commit secret-scan test fixture." }
}

try {
    $cleanRepository = New-TestRepository "clean"
    Commit-TestFile $cleanRepository "README.md" "Synthetic clean fixture."
    & $scanScript -RepositoryRoot $cleanRepository -ToolCache $toolCache | Out-Null

    $archivePath = Join-Path $toolCache "gitleaks-8.30.1\gitleaks_8.30.1_windows_x64.zip"
    [IO.File]::WriteAllText($archivePath, "tampered archive", [Text.UTF8Encoding]::new($false))
    $tamperedArchiveRejected = $false
    try {
        & $scanScript -RepositoryRoot $cleanRepository -ToolCache $toolCache *>$null
    } catch {
        $tamperedArchiveRejected = $true
    }
    if (-not $tamperedArchiveRejected) {
        throw "Secret scanner accepted a tampered tool archive."
    }
    Remove-Item -LiteralPath $archivePath -Force

    # The exact public release digest is ignored, but a different value at the
    # same path must still trip the generic API-key rule after a squash merge.
    $config = Get-Content (Join-Path (Split-Path -Parent $PSScriptRoot) '.gitleaks.toml') -Raw
    $manifestSource = Get-Content (Join-Path (Split-Path -Parent $PSScriptRoot) 'agent\neura\release-manifest.json') -Raw
    $manifest = $manifestSource | ConvertFrom-Json
    $publicDigest = $manifest.files.PSObject.Properties['agent/neura/ui-tokens.ts'].Value
    $manifestRepository = New-TestRepository "manifest"
    Commit-TestFile $manifestRepository '.gitleaks.toml' $config
    New-Item -ItemType Directory -Path (Join-Path $manifestRepository 'agent\neura') -Force | Out-Null
    $manifestFile = 'agent/neura/release-manifest.json'
    Commit-TestFile $manifestRepository $manifestFile $manifestSource
    & $scanScript -RepositoryRoot $manifestRepository -ToolCache $toolCache | Out-Null
    $otherDigest = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    Commit-TestFile $manifestRepository $manifestFile ($manifestSource.Replace($publicDigest, $otherDigest))
    $otherDigestRejected = $false
    try { & $scanScript -RepositoryRoot $manifestRepository -ToolCache $toolCache *>$null }
    catch {
        if ($_.FullyQualifiedErrorId -like 'Neura.SecretLeak*') { $otherDigestRejected = $true }
        else { throw }
    }
    if (-not $otherDigestRejected) { throw 'A different manifest digest bypassed the narrow allowlist.' }

    $offPathRepository = New-TestRepository "off-path"
    Commit-TestFile $offPathRepository '.gitleaks.toml' $config
    Commit-TestFile $offPathRepository 'fixture.txt' ('api_key="' + $publicDigest + '"')
    $offPathRejected = $false
    try { & $scanScript -RepositoryRoot $offPathRepository -ToolCache $toolCache *>$null }
    catch {
        if ($_.FullyQualifiedErrorId -like 'Neura.SecretLeak*') { $offPathRejected = $true }
        else { throw }
    }
    if (-not $offPathRejected) { throw 'The reviewed digest was ignored outside the manifest path.' }

    $leakRepository = New-TestRepository "leak"
    Commit-TestFile $leakRepository '.gitleaks.toml' $config
    $syntheticToken = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
    Commit-TestFile $leakRepository "fixture.txt" ("api_key=" + $syntheticToken)

    $leakMessage = $null
    try {
        & $scanScript -RepositoryRoot $leakRepository -ToolCache $toolCache | Out-Null
    } catch {
        $leakMessage = $_.Exception.Message
    }
    if ($leakMessage -notlike "*Gitleaks rejected repository history*") {
        throw "Secret fixture did not produce the expected Gitleaks rejection."
    }

    Write-Output "Neura secret tests: clean history and reviewed manifest digest passed; tampered archive, other digest, off-path key, and synthetic token rejected."
} finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    if ($resolvedTestRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTestRoot).StartsWith("neura-secret-tests-", [StringComparison]::Ordinal)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
