[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scanScript = Join-Path $PSScriptRoot "verify-secrets.ps1"
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot = Join-Path $tempRoot ("neura-secret-tests-" + [guid]::NewGuid().ToString("N"))
$toolCache = Join-Path $testRoot "tools"
# Fixed balanced canary stays above the scanner's entropy threshold; random GUIDs can be ignored.
$syntheticToken = ('a1b2c3d4e5f60789' * 4)

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

function Test-DownloadHelper {
    Add-Type -TypeDefinition 'public sealed class NeuraSyntheticWebResponse : System.Net.WebResponse { public System.Net.HttpStatusCode StatusCode { get; set; } }'
    function New-WebFailure([string]$Status, [int]$Code = 0) {
        $response = if ($Code) { [NeuraSyntheticWebResponse]@{ StatusCode = $Code } } else { $null }
        return [Net.WebException]::new("Synthetic $Status $Code.", $null, [Net.WebExceptionStatus]$Status, $response)
    }
    # $script: would bind to the child script, so the fakes share this object through dynamic scope.
    $downloadState = @{ Calls = 0; Steps = @(); Sleeps = @() }
    # These shadow the cmdlets for child scripts only while this function runs.
    function Invoke-WebRequest {
        param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile, [int]$TimeoutSec)
        $downloadState.Calls++
        if ($TimeoutSec -ne 60) { throw "Download helper used timeout $TimeoutSec." }
        if (Test-Path -LiteralPath $OutFile) { throw 'Download helper retried over a partial file.' }
        $step = $downloadState.Steps[$downloadState.Calls - 1]
        if ($step -is [Exception]) {
            [IO.File]::WriteAllText($OutFile, 'partial body', [Text.UTF8Encoding]::new($false))
            throw $step
        }
        [IO.File]::WriteAllText($OutFile, $step, [Text.UTF8Encoding]::new($false))
    }
    function Start-Sleep { param([int]$Seconds) $downloadState.Sleeps += @($Seconds) }

    $helper = Join-Path $PSScriptRoot 'download-verified.ps1'
    $target = Join-Path $testRoot 'download\artifact.bin'
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    $validBody = 'synthetic verified artifact'
    $sha256 = [Security.Cryptography.SHA256]::Create()
    $validHash = (($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($validBody)) | ForEach-Object { $_.ToString('x2') }) -join '')
    $sha256.Dispose()

    function Assert-Download([string]$Name, [object[]]$Steps, [int]$Calls, [int[]]$Sleeps, [string]$Failure, [string]$Cached) {
        Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
        if ($Cached) { [IO.File]::WriteAllText($target, $Cached, [Text.UTF8Encoding]::new($false)) }
        $downloadState.Steps = $Steps
        $downloadState.Calls = 0
        $downloadState.Sleeps = @()
        $message = ''
        try { & $helper -Uri 'https://example.invalid/artifact' -OutFile $target -Sha256 $validHash 3>$null }
        catch { $message = $_.Exception.Message }
        if ($downloadState.Calls -ne $Calls) { throw "${Name}: expected $Calls downloads, saw $($downloadState.Calls)." }
        if (($downloadState.Sleeps -join ',') -cne ($Sleeps -join ',')) { throw "${Name}: unexpected delays $($downloadState.Sleeps -join ',')." }
        if ($Failure) {
            if ($message -notlike "*$Failure*") { throw "${Name}: expected failure '$Failure', saw '$message'." }
        } elseif ($message) { throw "${Name}: unexpected failure '$message'." }
    }

    foreach ($transient in @((New-WebFailure 'ProtocolError' 504), (New-WebFailure 'ProtocolError' 502), (New-WebFailure 'ProtocolError' 503),
            (New-WebFailure 'Timeout'), (New-WebFailure 'ConnectFailure'), (New-WebFailure 'ConnectionClosed'), (New-WebFailure 'ReceiveFailure'), (New-WebFailure 'NameResolutionFailure'))) {
        Assert-Download "recovery: $($transient.Message)" @($transient, $validBody) 2 @(5) ''
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw 'Recovered download was not kept.' }
    }
    foreach ($permanent in @((New-WebFailure 'ProtocolError' 401), (New-WebFailure 'ProtocolError' 403), (New-WebFailure 'ProtocolError' 404),
            (New-WebFailure 'TrustFailure'), (New-WebFailure 'SecureChannelFailure'))) {
        Assert-Download "permanent: $($permanent.Message)" @($permanent, $validBody) 1 @() 'Synthetic'
        if (Test-Path -LiteralPath $target) { throw 'Failed download left a partial file.' }
    }
    Assert-Download 'exception outside the transport' @(([IO.IOException]::new('Synthetic disk failure.')), $validBody) 1 @() 'Synthetic disk failure'
    $exhausted = New-WebFailure 'ProtocolError' 504
    Assert-Download 'three transient failures' @($exhausted, $exhausted, $exhausted, $validBody) 3 @(5, 15) 'Synthetic ProtocolError 504'
    if (Test-Path -LiteralPath $target) { throw 'Exhausted download left a partial file.' }
    Assert-Download 'valid response with wrong bytes' @('wrong body', $validBody) 1 @() 'integrity check failed'
    Assert-Download 'valid cache' @() 0 @() '' $validBody
    Assert-Download 'tampered cache' @($validBody) 0 @() 'integrity check failed' 'tampered body'
    if ([IO.File]::ReadAllText($target) -cne 'tampered body') { throw 'Tampered cache was replaced instead of rejected.' }

    foreach ($invalid in @(@('http://example.invalid/artifact', $validHash), @('https://example.invalid/artifact', 'not-a-digest'))) {
        Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
        $downloadState.Calls = 0
        $rejected = $false
        try { & $helper -Uri $invalid[0] -OutFile $target -Sha256 $invalid[1] } catch { $rejected = $true }
        if (-not $rejected -or $downloadState.Calls -ne 0) { throw "Download helper accepted invalid input: $($invalid[0]) $($invalid[1])." }
    }

    $downloadState.Steps = @($exhausted, $exhausted, $exhausted)
    $downloadState.Calls = 0
    $downloadState.Sleeps = @()
    $scannerOutput = @()
    $scanFailed = $false
    $exhaustedCache = Join-Path $testRoot 'exhausted-tools'
    try { & $scanScript -RepositoryRoot $testRoot -ToolCache $exhaustedCache 3>$null | ForEach-Object { $scannerOutput += "$_" } }
    catch { $scanFailed = $true }
    if (-not $scanFailed -or $downloadState.Calls -ne 3 -or ($scannerOutput -join ' ') -like '*no leaks found*') {
        throw 'Scanner reported a result after its download was exhausted.'
    }
    if (Test-Path -LiteralPath (Join-Path $exhaustedCache 'gitleaks-8.30.1\gitleaks.exe')) { throw 'Exhausted scanner download produced an executable.' }
}

try {
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    Test-DownloadHelper

    $cleanRepository = New-TestRepository "clean"
    Commit-TestFile $cleanRepository "README.md" "Synthetic clean fixture."
    & $scanScript -RepositoryRoot $cleanRepository -ToolCache $toolCache | Out-Null

    $archivePath = Join-Path $toolCache "gitleaks-8.30.1\gitleaks_8.30.1_windows_x64.zip"
    $verifiedArchivePath = "$archivePath.verified"
    Copy-Item -LiteralPath $archivePath -Destination $verifiedArchivePath
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
    Move-Item -LiteralPath $verifiedArchivePath -Destination $archivePath -Force

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
    $otherDigest = $syntheticToken
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

    # The historical synthetic PEM exception is bound to one immutable commit.
    # An identical fixture at the same path/line in a new commit must still fail.
    $ignoreSource = Get-Content (Join-Path (Split-Path -Parent $PSScriptRoot) '.gitleaksignore') -Raw
    $pemFingerprint = '96ad5c37ada8f899e1dde9dafaf23759f2b958b3:scripts/tests/plan-confidentiality.mjs:private-key:28'
    $pemIgnores = @($ignoreSource -split '\r?\n' | Where-Object { $_ -match '^[^#].*:scripts/tests/plan-confidentiality\.mjs:private-key:' })
    if ($pemIgnores.Count -ne 1 -or $pemIgnores[0] -ne $pemFingerprint) {
        throw 'Synthetic PEM exception escaped its reviewed commit/path/rule/line binding.'
    }
    $pemRepository = New-TestRepository 'pem-fingerprint'
    Commit-TestFile $pemRepository '.gitleaks.toml' $config
    Commit-TestFile $pemRepository '.gitleaksignore' $ignoreSource
    New-Item -ItemType Directory -Path (Join-Path $pemRepository 'scripts\tests') -Force | Out-Null
    $pemFixture = Get-Content (Join-Path $PSScriptRoot 'tests\plan-confidentiality.mjs') -Raw
    Commit-TestFile $pemRepository 'scripts/tests/plan-confidentiality.mjs' $pemFixture
    $newPemRejected = $false
    try { & $scanScript -RepositoryRoot $pemRepository -ToolCache $toolCache *>$null }
    catch {
        if ($_.FullyQualifiedErrorId -like 'Neura.SecretLeak*') { $newPemRejected = $true }
        else { throw }
    }
    if (-not $newPemRejected) { throw 'Historical PEM fingerprint bypassed a different commit.' }

    # The requested repository, not the caller's directory, owns scan exceptions.
    $pemCommit = (& git -C $pemRepository rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $pemCommit -notmatch '^[0-9a-f]{40}$') { throw 'Could not resolve synthetic PEM commit.' }
    $newPemFingerprint = '{0}:scripts/tests/plan-confidentiality.mjs:private-key:28' -f $pemCommit
    $pemIgnorePath = Join-Path $pemRepository '.gitleaksignore'
    [IO.File]::WriteAllText($pemIgnorePath, $ignoreSource + "`r`n" + $newPemFingerprint + "`r`n", [Text.UTF8Encoding]::new($false))
    & $scanScript -RepositoryRoot $pemRepository -ToolCache $toolCache *>$null

    # A matching exception in an unrelated working directory must not suppress it.
    [IO.File]::WriteAllText($pemIgnorePath, $ignoreSource, [Text.UTF8Encoding]::new($false))
    $decoyDirectory = Join-Path $testRoot 'decoy-cwd'
    New-Item -ItemType Directory -Path $decoyDirectory -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $decoyDirectory '.gitleaksignore'), $newPemFingerprint + "`r`n", [Text.UTF8Encoding]::new($false))
    $decoyRejected = $false
    $previousProcessDirectory = [Environment]::CurrentDirectory
    Push-Location -LiteralPath $decoyDirectory
    try {
        try { & $scanScript -RepositoryRoot $pemRepository -ToolCache $toolCache *>$null }
        catch {
            if ($_.FullyQualifiedErrorId -like 'Neura.SecretLeak*') { $decoyRejected = $true }
            else { throw }
        }
    } finally {
        Pop-Location
        [Environment]::CurrentDirectory = $previousProcessDirectory
    }
    if (-not $decoyRejected) { throw 'Caller directory supplied an unauthorized scan exception.' }

    # Documentation exceptions remain bound to the reviewed historical commit.
    # Use synthetic content: the preserved local reference draft is not a release input.
    # Exactly the reviewed commits, in order; any other commit, path, rule or line stays scanned.
    $documentationFingerprints = @(
        'de328f3b28b431aad083219495e2cf8fab0f6db6:docs/MASTRA_MIGRATION_REFERENCE.md:generic-api-key:484',
        'a5f6a19aa5161abe6372e23564a768c943db10d0:docs/MASTRA_MIGRATION_REFERENCE.md:generic-api-key:484'
    )
    $documentationIgnores = @($ignoreSource -split '\r?\n' | Where-Object { $_ -match '^[^#].*:docs/MASTRA_MIGRATION_REFERENCE\.md:generic-api-key:' })
    if (($documentationIgnores -join "`n") -cne ($documentationFingerprints -join "`n")) {
        throw 'Documentation exception escaped its reviewed commit/path/rule/line binding.'
    }
    $documentationRepository = New-TestRepository 'documentation-fingerprint'
    Commit-TestFile $documentationRepository '.gitleaks.toml' $config
    Commit-TestFile $documentationRepository '.gitleaksignore' $ignoreSource
    New-Item -ItemType Directory -Path (Join-Path $documentationRepository 'docs') -Force | Out-Null
    $documentationPath = 'docs/MASTRA_MIGRATION_REFERENCE.md'
    $documentationProse = 'The central redactor covers known {0} assignments, environment/header/CLI forms.' -f 'secret'
    $documentationFixture = ((@('') * 483) + @($documentationProse)) -join "`n"
    Commit-TestFile $documentationRepository $documentationPath $documentationFixture
    $newProseRejected = $false
    try { & $scanScript -RepositoryRoot $documentationRepository -ToolCache $toolCache *>$null }
    catch {
        if ($_.FullyQualifiedErrorId -like 'Neura.SecretLeak*') { $newProseRejected = $true }
        else { throw }
    }
    if (-not $newProseRejected) { throw 'Historical documentation fingerprint bypassed a different commit.' }

    $documentationCommit = (& git -C $documentationRepository rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $documentationCommit -notmatch '^[0-9a-f]{40}$') { throw 'Could not resolve synthetic documentation commit.' }
    $documentationIgnorePath = Join-Path $documentationRepository '.gitleaksignore'
    $reviewedProseFingerprint = '{0}:{1}:generic-api-key:484' -f $documentationCommit, $documentationPath
    [IO.File]::WriteAllText($documentationIgnorePath, $ignoreSource + "`r`n" + $reviewedProseFingerprint + "`r`n", [Text.UTF8Encoding]::new($false))
    & $scanScript -RepositoryRoot $documentationRepository -ToolCache $toolCache *>$null

    $documentationCanary = 'api_key="{0}"' -f $syntheticToken
    Commit-TestFile $documentationRepository $documentationPath (((@('') * 483) + @($documentationCanary)) -join "`n")
    $newCanaryRejected = $false
    try { & $scanScript -RepositoryRoot $documentationRepository -ToolCache $toolCache *>$null }
    catch {
        if ($_.FullyQualifiedErrorId -like 'Neura.SecretLeak*') { $newCanaryRejected = $true }
        else { throw }
    }
    if (-not $newCanaryRejected) { throw 'Documentation exception bypassed a new canary at the same path and line.' }

    Write-Output "Neura secret tests: bounded verified downloads, clean history, reviewed manifest digest, exact PEM/documentation binding and target-repository ignore passed; tampered archive, other digest, off-path key, synthetic token, new-commit PEM/prose, same-line canary and decoy-CWD exception rejected."
} catch {
    Write-Output "Secret test failed before cleanup: $($_.FullyQualifiedErrorId)"
    throw
} finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    if ($resolvedTestRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTestRoot).StartsWith("neura-secret-tests-", [StringComparison]::Ordinal)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
