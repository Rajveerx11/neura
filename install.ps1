# Neura installer - installs the harness or checks live drift.
param(
    [switch]$Check,
    [switch]$ForceSettings
)

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot
$agent = if ($env:PI_CODING_AGENT_DIR) { [System.IO.Path]::GetFullPath($env:PI_CODING_AGENT_DIR) } else { Join-Path $HOME ".pi\agent" }
$bin = Join-Path $HOME ".local\bin"
$retiredExtensions = @("autogit.ts")
$runtimeContractPath = Join-Path $repo "agent\neura\runtime-contract.json"
try {
    $runtimeContract = Get-Content $runtimeContractPath -Raw | ConvertFrom-Json
    $requiredPiVersion = [string]$runtimeContract.piVersion
    $releaseManifest = Get-Content (Join-Path $repo 'agent\neura\release-manifest.json') -Raw | ConvertFrom-Json
    $requiredNodeVersion = [string]$releaseManifest.nodeMinimum
    if ($releaseManifest.schemaVersion -ne 1 -or $releaseManifest.piVersion -ne $requiredPiVersion -or $requiredNodeVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'release manifest disagrees with runtime contract' }
    $schemaIsInteger = ($runtimeContract.schemaVersion -is [int]) -or ($runtimeContract.schemaVersion -is [long])
    if (-not $schemaIsInteger -or $runtimeContract.schemaVersion -ne 1 -or $requiredPiVersion -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
        throw "unsupported runtime contract"
    }
} catch {
    throw "Neura runtime contract is missing or invalid: $runtimeContractPath"
}

function Test-Command($Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-ProofRuntime {
    if (-not (Test-Command "node")) { return $false }
    $previousErrorAction = $ErrorActionPreference
    try {
        # Windows PowerShell promotes native stderr to NativeCommandError when
        # the optional runtime reports unavailable. Keep the probe non-fatal.
        $ErrorActionPreference = "SilentlyContinue"
        & node (Join-Path $repo "scripts\check-proof-runtime.mjs") *> $null
        return $LASTEXITCODE -eq 0
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
}

function Normalize-Text($Value) {
    $normalized = $Value -replace "`r`n?", "`n"
    return $normalized.TrimEnd([char[]]@([char]10))
}

function Get-PackageIdentity($Spec) {
    $source = $Spec.PSObject.Properties["source"]
    $value = if ($source) { [string]$source.Value } else { [string]$Spec }
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

function Test-PackageSpecEqual($Left, $Right) {
    return ($Left | ConvertTo-Json -Depth 20 -Compress) -ceq ($Right | ConvertTo-Json -Depth 20 -Compress)
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

function Get-NeuraTerminalFragment($ProfileId, $LauncherPath, $ArtworkPath) {
    [ordered]@{
        profiles = @(
            [ordered]@{
                guid = $ProfileId
                name = "Neura"
                commandline = "cmd.exe /d /s /c `"`"$LauncherPath`"`""
                startingDirectory = "%USERPROFILE%"
                background = "#0b0c0e"
                foreground = "#e8e2d8"
                backgroundImage = $ArtworkPath
                backgroundImageAlignment = "center"
                backgroundImageOpacity = 0.42
                backgroundImageStretchMode = "uniform"
                opacity = 100
                padding = "12"
                useAcrylic = $false
                environment = [ordered]@{
                    PI_SKIP_VERSION_CHECK = "1"
                }
            }
        )
    } | ConvertTo-Json -Depth 10
}

$terminalProfileId = "{7e8b22c4-2cd7-5f7c-b5a8-a461f718bdaf}"
$terminalFragmentDirectory = Join-Path $env:LOCALAPPDATA "Microsoft\Windows Terminal\Fragments\Neura"
$terminalFragmentPath = Join-Path $terminalFragmentDirectory "Neura.json"
$terminalShortcutPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Neura.lnk"
$launchArtworkTarget = Join-Path "$agent\neura" "launch-artwork.png"
$launcherTarget = Join-Path $bin "neura.cmd"
$terminalFragment = Get-NeuraTerminalFragment $terminalProfileId $launcherTarget $launchArtworkTarget

if ($Check) {
    $missing = @()
    $drift = @()
    $capabilityWarnings = @()
    $credentialWarnings = @()
    if (-not (Test-Command "node")) {
        $missing += "Node.js 24.15 or newer"
    } elseif ([version]((& node --version).Trim().TrimStart('v')) -lt [version]$requiredNodeVersion) {
        $drift += "Node.js 24.15 or newer is required for Neura"
    }
    foreach ($cmd in @("pi", "git")) {
        if (-not (Test-Command $cmd)) { $missing += $cmd }
    }
    if (Test-Command "pi") {
        $piVersion = (& pi --version).Trim()
        if ($piVersion -ne $requiredPiVersion) { $drift += "Pi $piVersion installed; required $requiredPiVersion" }
    }
    if (-not (Test-ProofRuntime)) {
        $capabilityWarnings += "WSL proof runtime unavailable or different from runtime-contract.json (optional proof capability unavailable)"
    }
    if (Test-Command 'node') {
        & node (Join-Path $repo 'agent\neura\runtime-install.mjs') check --source
        if ($LASTEXITCODE -ne 0) { $drift += 'release manifest, installed hashes, or extension ownership differs' }
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
    $learnLock = Join-Path "$agent\neura" "package-lock.json"
    $learnReceipt = Join-Path "$agent\neura" ".learn-runtime-lock"
    if (-not (Test-Path -LiteralPath $learnLock) -or -not (Test-Path -LiteralPath "$agent\neura\node_modules\.package-lock.json") -or -not (Test-Path -LiteralPath $learnReceipt)) {
        $drift += "Learn document runtime dependencies missing"
    } elseif ((Get-Content -LiteralPath $learnReceipt -Raw).Trim() -ne (Get-FileHash -LiteralPath $learnLock -Algorithm SHA256).Hash) {
        $drift += "Learn document runtime lock changed; reinstall dependencies"
    }
    foreach ($pair in @(
        @("$repo\agent\mcp.json", "$agent\mcp.json"),
        @("$repo\launcher\neura.cmd", $launcherTarget)
    )) {
        if (-not (Test-Path $pair[1])) {
            $drift += "$(Split-Path $pair[0] -Leaf) missing"
        } elseif (-not (Test-SameFile $pair[0] $pair[1])) {
            $drift += "$(Split-Path $pair[0] -Leaf) differs"
        }
    }
    if (Test-Command "wt.exe") {
        if (-not (Test-Path -LiteralPath $terminalFragmentPath)) {
            $drift += "Windows Terminal Neura profile missing"
        } elseif ((Normalize-Text ([System.IO.File]::ReadAllText($terminalFragmentPath))) -cne (Normalize-Text $terminalFragment)) {
            $drift += "Windows Terminal Neura profile differs"
        }
        if (-not (Test-Path -LiteralPath $terminalShortcutPath)) {
            $drift += "Neura Start menu shortcut missing"
        } else {
            try {
                $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($terminalShortcutPath)
                if ($shortcut.Arguments -ne "-w new -p Neura") { $drift += "Neura Start menu shortcut differs" }
            } catch {
                $drift += "Neura Start menu shortcut unreadable"
            }
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
                if ($sameIdentity.Count -ne 1 -or -not (Test-PackageSpecEqual $sameIdentity[0] $desiredPackage)) {
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
    if ($capabilityWarnings.Count) { Write-Warning ($capabilityWarnings -join '; ') }
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

if (-not (Test-Command "npm")) { throw "npm is required to install the Learn document runtime." }
if (-not (Test-Command "node")) { throw "Node.js 24.15 or newer is required for Neura." }
$learnNodeVersion = (& node --version).Trim().TrimStart('v')
if ([version]$learnNodeVersion -lt [version]$requiredNodeVersion) { throw "Node.js 24.15 or newer is required for Neura." }
# Validate private user configuration before activating managed code; never copy it to staging.
foreach ($config in @("$agent\settings.json", "$agent\keybindings.json")) {
    if (Test-Path $config) { try { $null = Get-Content $config -Raw | ConvertFrom-Json } catch { throw "Existing configuration is invalid: $config" } }
}
$installer = Join-Path $repo 'agent\neura\runtime-install.mjs'
$staging = & node $installer prepare
if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare Neura release; inspect extension ownership and source hashes.' }
try {
    # Install only the reviewed, locked document runtime in staging, never into live Pi.
    & npm.cmd ci --prefix (Join-Path $staging 'agent\neura') --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Learn document runtime installation failed.' }
    $learnStage = Join-Path $staging 'agent\neura'
    $learnLockHash = (Get-FileHash -LiteralPath (Join-Path $learnStage 'package-lock.json') -Algorithm SHA256).Hash
    [System.IO.File]::WriteAllText((Join-Path $learnStage '.learn-runtime-lock'), $learnLockHash)
    & node $installer seal
    if ($LASTEXITCODE -ne 0) { throw 'Staged release validation failed.' }
    & node $installer activate
    if ($LASTEXITCODE -ne 0) { throw 'Managed-file activation failed; previous files restored.' }
} catch {
    & node $installer recover
    throw
}

if (Test-Command "wt.exe") {
    New-Item -ItemType Directory -Force $terminalFragmentDirectory | Out-Null
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($terminalFragmentPath, $terminalFragment, $utf8NoBom)
    $terminalCommand = Get-Command "wt.exe"
    $shortcutShell = New-Object -ComObject WScript.Shell
    $shortcut = $shortcutShell.CreateShortcut($terminalShortcutPath)
    $shortcut.TargetPath = $terminalCommand.Source
    $shortcut.Arguments = "-w new -p Neura"
    $shortcut.WorkingDirectory = $HOME
    $shortcut.Description = "Launch Neura with its image-backed terminal profile"
    $shortcut.IconLocation = "$($terminalCommand.Source),0"
    $shortcut.Save()
    Write-Host "Windows Terminal profile and Start menu shortcut installed."
} else {
    Write-Warning "Windows Terminal not found: Neura will use its logo-only launch fallback."
}

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
        if ($sameIdentity.Count -ne 1 -or -not (Test-PackageSpecEqual $sameIdentity[0] $desiredPackage)) {
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

if (-not (Test-ProofRuntime)) { Write-Warning "WSL proof runtime unavailable or different from runtime-contract.json; proof will remain unavailable." }
Write-Host "Neura installed. Run 'pi update --extensions --approve', then 'neura' and '/health'."
