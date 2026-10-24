@echo off
title neura
rem Only Neura launch is guarded; invoking pi directly remains unchanged.
set "NEURA_AGENT_DIR=%USERPROFILE%\.pi\agent"
if defined PI_CODING_AGENT_DIR set "NEURA_AGENT_DIR=%PI_CODING_AGENT_DIR%"
call node "%NEURA_AGENT_DIR%\neura\runtime-install.mjs" check || exit /b 1
set "NEURA=1"

rem Use the sealed unbundled CLI; never dispatch to stock/global Pi.
node "%NEURA_AGENT_DIR%\neura\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" --no-mcp --tui-mode regular %*
exit /b %errorlevel%
