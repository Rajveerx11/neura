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
    $desiredKeybindings = Get-Content "$repo\agent\keybindings.json" -Raw | ConvertFrom-Json
    $liveKeybindingsPath = Join-Path $agent "keybindings.json"
    if (-not (Test-Path $liveKeybindingsPath)) {
        $drift += "keybindings.json missing (Shift+Tab unavailable for modes)"
    } else {
        try {
            $liveKeybindings = Get-Content $liveKeybindingsPath -Raw | ConvertFrom-Json
            $desiredThinking = $desiredKeybindings.PSObject.Properties["app.thinking.cycle"].Value
            $liveThinking = $liveKeybindings.PSObject.Properties["app.thinking.cycle"].Value
            if ($liveThinking -ne $desiredThinking) {
                $drift += "keybindings.json does not free Shift+Tab"
            }
        } catch {
            $drift += "keybindings.json is invalid"
        }
    }
    $desiredSettings = Get-Content "$repo\agent\settings.json" -Raw | ConvertFrom-Json
    $desiredSkillExclusions = @($desiredSettings.skills | Where-Object { [string]$_ -like "!*" })
    $liveSettingsPath = Join-Path $agent "settings.json"
    if (-not (Test-Path $liveSettingsPath)) {
        $drift += "settings.json missing"
    } else {
        try {
            $liveSettings = Get-Content $liveSettingsPath -Raw | ConvertFrom-Json
            $liveSkills = @($liveSettings.skills)
            foreach ($exclusion in $desiredSkillExclusions) {
                if ($liveSkills -notcontains $exclusion) {
                    $drift += "settings.json missing skill collision exclusion $exclusion"
                }
            }
        } catch {
            $drift += "settings.json is invalid"
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

# Shift+Tab belongs to Neura mode cycling. Preserve every user binding while moving
# pi's built-in thinking-level cycle to Ctrl+Shift+T.
$keybindingsSource = Get-Content "$repo\agent\keybindings.json" -Raw | ConvertFrom-Json
$keybindingsTarget = Join-Path $agent "keybindings.json"
if (Test-Path $keybindingsTarget) {
    try { $keybindings = Get-Content $keybindingsTarget -Raw | ConvertFrom-Json }
    catch { throw "Existing keybindings.json is invalid; fix it before installing: $keybindingsTarget" }
} else {
    $keybindings = [PSCustomObject]@{}
}
$thinkingBinding = $keybindingsSource.PSObject.Properties["app.thinking.cycle"].Value
$keybindings | Add-Member -NotePropertyName "app.thinking.cycle" -NotePropertyValue $thinkingBinding -Force
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($keybindingsTarget, ($keybindings | ConvertTo-Json -Depth 20), $utf8NoBom)

# settings.json: preserve local credentials and choices unless explicitly forced
$target = "$agent\settings.json"
if ((Test-Path $target) -and -not $ForceSettings) {
    try { $liveSettings = Get-Content $target -Raw | ConvertFrom-Json }
    catch { throw "Existing settings.json is invalid; fix it before installing: $target" }
    $sourceSettings = Get-Content "$repo\agent\settings.json" -Raw | ConvertFrom-Json
    $desiredSkillExclusions = @($sourceSettings.skills | Where-Object { [string]$_ -like "!*" })
    $liveSkills = @($liveSettings.skills)
    $settingsChanged = $false
    foreach ($exclusion in $desiredSkillExclusions) {
        if ($liveSkills -notcontains $exclusion) {
            $liveSkills += $exclusion
            $settingsChanged = $true
        }
    }
    if ($settingsChanged) {
        $liveSettings | Add-Member -NotePropertyName "skills" -NotePropertyValue @($liveSkills) -Force
        [System.IO.File]::WriteAllText($target, ($liveSettings | ConvertTo-Json -Depth 20), $utf8NoBom)
        Write-Host "settings.json choices preserved; duplicate-skill exclusions merged."
    } else {
        Write-Host "settings.json already exists at $target - choices preserved."
    }
} else {
    Copy-Item "$repo\agent\settings.json" $target -Force
}

if (-not (Test-Command "uvx")) { Write-Warning "uvx missing: proof-of-work verification will be unavailable." }
if (-not (Test-Command "autogit")) { Write-Warning "autogit missing: automatic commit/push will be unavailable." }
Write-Host "Neura installed. Run 'pi install', then 'neura' and '/health'."
