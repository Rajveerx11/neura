# Neura installer - installs the harness or checks live drift.
param(
    [switch]$Check,
    [switch]$ForceSettings
)

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot
$agent = Join-Path $HOME ".pi\agent"
$bin = Join-Path $HOME ".local\bin"

function Test-Command($Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if ($Check) {
    $missing = @()
    foreach ($cmd in @("pi", "git", "uvx")) {
        if (-not (Test-Command $cmd)) { $missing += $cmd }
    }
    $pairs = @(
        @("$repo\agent\extensions", "$agent\extensions"),
        @("$repo\agent\themes", "$agent\themes"),
        @("$repo\agent\neura", "$agent\neura")
    )
    $drift = @()
    foreach ($pair in $pairs) {
        Get-ChildItem $pair[0] -File | ForEach-Object {
            $live = Join-Path $pair[1] $_.Name
            if (-not (Test-Path $live)) {
                $drift += "$($_.Name) missing"
            } elseif ((Get-FileHash $_.FullName).Hash -ne (Get-FileHash $live).Hash) {
                $drift += "$($_.Name) differs"
            }
        }
    }
    foreach ($pair in @(
        @("$repo\agent\mcp.json", "$agent\mcp.json"),
        @("$repo\launcher\neura.cmd", "$bin\neura.cmd")
    )) {
        if (-not (Test-Path $pair[1])) {
            $drift += "$(Split-Path $pair[0] -Leaf) missing"
        } elseif ((Get-FileHash $pair[0]).Hash -ne (Get-FileHash $pair[1]).Hash) {
            $drift += "$(Split-Path $pair[0] -Leaf) differs"
        }
    }
    if ($missing.Count) { Write-Warning "Missing required commands: $($missing -join ', ')" }
    if ($drift.Count) { Write-Warning "Live harness drift: $($drift -join '; ')" }
    if (-not $missing.Count -and -not $drift.Count) { Write-Host "Neura health: ready, live harness matches source." }
    exit $(if ($missing.Count -or $drift.Count) { 1 } else { 0 })
}

if (-not (Test-Command "pi")) {
    throw "pi is not installed. Run: npm install -g @earendil-works/pi-coding-agent"
}

New-Item -ItemType Directory -Force "$agent\extensions", "$agent\themes", "$agent\neura", $bin | Out-Null
Copy-Item "$repo\agent\extensions\*" "$agent\extensions\" -Force
Copy-Item "$repo\agent\themes\*" "$agent\themes\" -Force
Copy-Item "$repo\agent\neura\*" "$agent\neura\" -Force
Copy-Item "$repo\launcher\neura.cmd" "$bin\" -Force
Copy-Item "$repo\agent\mcp.json" "$agent\" -Force  # no secrets; tokens flow via MY_PI_MCP_ENV_ALLOWLIST

# settings.json: preserve local credentials and choices unless explicitly forced
$target = "$agent\settings.json"
if ((Test-Path $target) -and -not $ForceSettings) {
    Write-Host "settings.json already exists at $target - NOT overwritten. Diff manually against $repo\agent\settings.json"
} else {
    Copy-Item "$repo\agent\settings.json" $target -Force
}

if (-not (Test-Command "uvx")) { Write-Warning "uvx missing: proof-of-work verification will be unavailable." }
if (-not (Test-Command "autogit")) { Write-Warning "autogit missing: automatic commit/push will be unavailable." }
Write-Host "Neura installed. Run 'pi install', then 'neura' and '/health'."
