@echo off
if defined NEURA_TERMINAL_PROFILE goto terminal_ready
where wt >nul 2>&1 || goto terminal_ready
wt -w new nt -p Neura cmd.exe /d /s /c ""%~f0" %*"
exit /b %errorlevel%

:terminal_ready
title neura
set "NEURA=1"

rem pi-mcp expands HTTP header variables only from its explicit MCP allowlist.
rem Refresh user-scoped values so terminals opened before setup still work.
if defined COMPOSIO_API_KEY if defined MY_PI_MCP_ENV_ALLOWLIST goto environment_ready
for /f "tokens=1,* delims==" %%K in ('powershell -NoProfile -NonInteractive -Command "$names='COMPOSIO_API_KEY','MY_PI_MCP_ENV_ALLOWLIST'; foreach ($name in $names) { if (-not [Environment]::GetEnvironmentVariable($name,'Process')) { $value=[Environment]::GetEnvironmentVariable($name,'User'); if ($null -ne $value) { Write-Output ($name + '=' + $value) } } }"') do set "%%K=%%L"

:environment_ready
if defined COMPOSIO_API_KEY set "MY_PI_MCP_ENV_ALLOWLIST=COMPOSIO_API_KEY,%MY_PI_MCP_ENV_ALLOWLIST%"

where pi >nul 2>&1 || (
  echo Neura requires Pi. Run: npm install -g @earendil-works/pi-coding-agent 1>&2
  exit /b 1
)
pi %*
