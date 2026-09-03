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

    $leakRepository = New-TestRepository "leak"
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

    Write-Output "Neura secret tests: clean history passed; tampered archive and synthetic committed token rejected."
} finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    if ($resolvedTestRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTestRoot).StartsWith("neura-secret-tests-", [StringComparison]::Ordinal)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
