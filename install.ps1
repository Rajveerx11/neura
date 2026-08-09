# Neura installer - installs the harness or checks live drift.
param(
    [switch]$Check,
    [switch]$ForceSettings
)

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot
$agent = Join-Path $HOME ".pi\agent"
$bin = Join-Path $HOME ".local\bin"
$retiredExtensions = @("autogit.ts")
$requiredPiVersion = "0.84.1"

function Test-Command($Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Normalize-Text($Value) {
    $normalized = $Value -replace "`r`n?", "`n"
    return $normalized.TrimEnd([char[]]@([char]10))
}

function Get-PackageIdentity($Spec) {
    $value = [string]$Spec
    if (-not $value.StartsWith("npm:")) { return $value }
    $package = $value.Substring(4)
    if ($package.StartsWith("@")) {
        $slash = $package.IndexOf("/")
        $versionAt = if ($slash -ge 0) { $package.IndexOf("@", $slash) } else { -1 }
    } else {
        $versionAt = $package.LastIndexOf("@")
    }
    if ($versionAt -gt 0) { $package = $package.Substring(0, $versionAt) }
    return "npm:$package"
}

function Test-SameFile($Source, $Target) {
    $textExtensions = @(".ts", ".json", ".md", ".cmd", ".ps1", ".mjs")
    $extension = [System.IO.Path]::GetExtension($Source).ToLowerInvariant()
    if ($textExtensions -contains $extension) {
        try {
            $sourceText = Normalize-Text ([System.IO.File]::ReadAllText($Source))
            $targetText = Normalize-Text ([System.IO.File]::ReadAllText($Target))
            return $sourceText -ceq $targetText
        } catch {
            return $false
        }
    }
    return (Get-FileHash $Source).Hash -eq (Get-FileHash $Target).Hash
}

if ($Check) {
    $missing = @()
    $drift = @()
    $credentialWarnings = @()
    foreach ($cmd in @("pi", "git", "uvx")) {
        if (-not (Test-Command $cmd)) { $missing += $cmd }
    }
    if (Test-Command "pi") {
        $piVersion = (& pi --version).Trim()
        if ($piVersion -ne $requiredPiVersion) { $drift += "Pi $piVersion installed; required $requiredPiVersion" }
    }
    $pairs = @(
        @("$repo\agent\extensions", "$agent\extensions"),
        @("$repo\agent\themes", "$agent\themes"),
        @("$repo\agent\neura", "$agent\neura")
    )
    foreach ($pair in $pairs) {
        Get-ChildItem $pair[0] -File | ForEach-Object {
            $live = Join-Path $pair[1] $_.Name
            if (-not (Test-Path $live)) {
                $drift += "$($_.Name) missing"
            } elseif (-not (Test-SameFile $_.FullName $live)) {
                $drift += "$($_.Name) differs"
            }
        }
    }
    foreach ($name in $retiredExtensions) {
        if (Test-Path (Join-Path "$agent\extensions" $name)) {
            $drift += "$name is retired but remains installed"
        }
    }
    foreach ($pair in @(
        @("$repo\agent\mcp.json", "$agent\mcp.json"),
        @("$repo\launcher\neura.cmd", "$bin\neura.cmd")
    )) {
        if (-not (Test-Path $pair[1])) {
            $drift += "$(Split-Path $pair[0] -Leaf) missing"
        } elseif (-not (Test-SameFile $pair[0] $pair[1])) {
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
    $desiredPackages = @($desiredSettings.packages)
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
            $livePackages = @($liveSettings.packages)
            foreach ($desiredPackage in $desiredPackages) {
                $identity = Get-PackageIdentity $desiredPackage
                $sameIdentity = @($livePackages | Where-Object { (Get-PackageIdentity $_) -eq $identity })
                if ($sameIdentity.Count -ne 1 -or $sameIdentity[0] -ne $desiredPackage) {
                    $drift += "settings.json runtime package is not exactly pinned: $identity"
                }
            }
        } catch {
            $drift += "settings.json is invalid"
        }
    }
    try {
        $desiredMcp = Get-Content "$repo\agent\mcp.json" -Raw | ConvertFrom-Json
        $gmail = $desiredMcp.mcpServers.PSObject.Properties["gmail"]
        if ($gmail -and $gmail.Value.disabled -ne $true) {
            $composioKey = [Environment]::GetEnvironmentVariable("COMPOSIO_API_KEY", "User")
            if ([string]::IsNullOrWhiteSpace($composioKey)) {
                $credentialWarnings += "COMPOSIO_API_KEY missing from Windows user environment (optional Gmail MCP unavailable)"
            }
        }
    } catch {
        $drift += "mcp.json is invalid"
    }
    if ($missing.Count) { Write-Warning "Missing required commands: $($missing -join ', ')" }
    if ($drift.Count) { Write-Warning "Live harness drift: $($drift -join '; ')" }
    if ($credentialWarnings.Count) { Write-Warning ($credentialWarnings -join '; ') }
    if (-not $missing.Count -and -not $drift.Count) { Write-Host "Neura health: ready, live harness matches source." }
    exit $(if ($missing.Count -or $drift.Count) { 1 } else { 0 })
}

if (-not (Test-Command "pi")) {
    throw "pi is not installed. Run: npm install -g @earendil-works/pi-coding-agent@$requiredPiVersion"
}
$piVersion = (& pi --version).Trim()
if ($piVersion -ne $requiredPiVersion) {
    throw "Pi $piVersion is installed; Neura requires $requiredPiVersion. Run: npm install -g @earendil-works/pi-coding-agent@$requiredPiVersion"
}

New-Item -ItemType Directory -Force "$agent\extensions", "$agent\themes", "$agent\neura", $bin | Out-Null
foreach ($name in $retiredExtensions) {
    $retiredPath = Join-Path "$agent\extensions" $name
    if (Test-Path $retiredPath) { Remove-Item -LiteralPath $retiredPath -Force }
}
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
    $desiredPackages = @($sourceSettings.packages)
    $liveSkills = @($liveSettings.skills)
    $livePackages = @($liveSettings.packages)
    $settingsChanged = $false
    foreach ($exclusion in $desiredSkillExclusions) {
        if ($liveSkills -notcontains $exclusion) {
            $liveSkills += $exclusion
            $settingsChanged = $true
        }
    }
    foreach ($desiredPackage in $desiredPackages) {
        $identity = Get-PackageIdentity $desiredPackage
        $sameIdentity = @($livePackages | Where-Object { (Get-PackageIdentity $_) -eq $identity })
        if ($sameIdentity.Count -ne 1 -or $sameIdentity[0] -ne $desiredPackage) {
            $livePackages = @($livePackages | Where-Object { (Get-PackageIdentity $_) -ne $identity }) + $desiredPackage
            $settingsChanged = $true
        }
    }
    if ($settingsChanged) {
        $liveSettings | Add-Member -NotePropertyName "skills" -NotePropertyValue @($liveSkills) -Force
        $liveSettings | Add-Member -NotePropertyName "packages" -NotePropertyValue @($livePackages) -Force
        [System.IO.File]::WriteAllText($target, ($liveSettings | ConvertTo-Json -Depth 20), $utf8NoBom)
        Write-Host "settings.json choices preserved; Neura exclusions and exact package pins merged."
    } else {
        Write-Host "settings.json already exists at $target - choices preserved."
    }
} else {
    Copy-Item "$repo\agent\settings.json" $target -Force
}

if (-not (Test-Command "uvx")) { Write-Warning "uvx missing: proof-of-work verification will be unavailable." }
Write-Host "Neura installed. Run 'pi update --extensions --approve', then 'neura' and '/health'."
