@echo off
title neura
set "NEURA=1"

rem pi-mcp expands HTTP header variables only from its explicit MCP allowlist.
rem Refresh user-scoped values so terminals opened before setup still work.
if not defined COMPOSIO_API_KEY for /f "usebackq delims=" %%K in (`powershell -NoProfile -NonInteractive -Command "[Environment]::GetEnvironmentVariable('COMPOSIO_API_KEY','User')"`) do set "COMPOSIO_API_KEY=%%K"
if not defined MY_PI_MCP_ENV_ALLOWLIST for /f "usebackq delims=" %%K in (`powershell -NoProfile -NonInteractive -Command "[Environment]::GetEnvironmentVariable('MY_PI_MCP_ENV_ALLOWLIST','User')"`) do set "MY_PI_MCP_ENV_ALLOWLIST=%%K"
if defined COMPOSIO_API_KEY set "MY_PI_MCP_ENV_ALLOWLIST=COMPOSIO_API_KEY,%MY_PI_MCP_ENV_ALLOWLIST%"

pi %*
