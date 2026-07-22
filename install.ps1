# Neura installer — copies the harness into place on a fresh machine.
# Prereq: npm install -g @earendil-works/pi-coding-agent
$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot
$agent = Join-Path $HOME ".pi\agent"
$bin = Join-Path $HOME ".local\bin"

New-Item -ItemType Directory -Force "$agent\extensions", "$agent\themes", "$agent\neura", $bin | Out-Null
Copy-Item "$repo\agent\extensions\*" "$agent\extensions\" -Force
Copy-Item "$repo\agent\themes\*" "$agent\themes\" -Force
Copy-Item "$repo\agent\neura\*" "$agent\neura\" -Force
Copy-Item "$repo\launcher\neura.cmd" "$bin\" -Force
Copy-Item "$repo\agent\mcp.json" "$agent\" -Force  # no secrets — tokens flow via MY_PI_MCP_ENV_ALLOWLIST env vars

# settings.json: don't clobber an existing one blindly
$target = "$agent\settings.json"
if (Test-Path $target) {
    Write-Host "settings.json already exists at $target — NOT overwritten. Diff manually against $repo\agent\settings.json"
} else {
    Copy-Item "$repo\agent\settings.json" $target
}

Write-Host "Neura installed. Run 'pi install' packages if missing (see settings.json), ensure $bin is on PATH, then type: neura"
