[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^https://')][string]$Uri,
    [Parameter(Mandatory)][string]$OutFile,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$Sha256
)

# Windows PowerShell 5.1 contract. Other editions raise different exception types and fail without retry.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Windows PowerShell's download progress display slows large files.
$ProgressPreference = 'SilentlyContinue'

$maximumAttempts = 3
$retryDelaySeconds = @(5, 15)

function Test-TransientDownloadFailure([Exception]$Failure) {
    if ($Failure -isnot [Net.WebException]) { return $false }
    if ($Failure.Status -ne [Net.WebExceptionStatus]::ProtocolError) {
        return $Failure.Status.ToString() -in @('Timeout', 'ConnectFailure', 'ConnectionClosed', 'ReceiveFailure', 'NameResolutionFailure')
    }
    $response = $Failure.Response
    if ($null -eq $response -or -not $response.PSObject.Properties['StatusCode']) { return $false }
    return [int]$response.StatusCode -in @(502, 503, 504)
}

if (-not (Test-Path -LiteralPath $OutFile -PathType Leaf)) {
    for ($attempt = 1; ; $attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile -TimeoutSec 60
            break
        } catch {
            $failure = $_
            if (Test-Path -LiteralPath $OutFile -PathType Leaf) { Remove-Item -LiteralPath $OutFile -Force }
            if ($attempt -ge $maximumAttempts -or -not (Test-TransientDownloadFailure $failure.Exception)) { throw $failure }
            $delay = $retryDelaySeconds[$attempt - 1]
            Write-Warning "Transient download failure on attempt $attempt of ${maximumAttempts}: $($failure.Exception.Message) Retrying in $delay seconds."
            Start-Sleep -Seconds $delay
        }
    }
}

# Integrity is outside the retry loop, so a wrong body can never be retried into acceptance.
$actualSha256 = (Get-FileHash -LiteralPath $OutFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $Sha256) {
    throw "Download integrity check failed for $OutFile. Expected $Sha256; received $actualSha256."
}
