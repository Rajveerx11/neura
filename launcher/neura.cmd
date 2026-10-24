@echo off
title neura
rem Only Neura launch is guarded; invoking pi directly remains unchanged.
set "NEURA_AGENT_DIR=%USERPROFILE%\.pi\agent"
if defined PI_CODING_AGENT_DIR set "NEURA_AGENT_DIR=%PI_CODING_AGENT_DIR%"
rem Parse launcher arguments in Node, not CMD string comparisons or CALL expansion.
node "%NEURA_AGENT_DIR%\neura\runtime-install.mjs" launch-check %*
if not errorlevel 0 exit /b 1
if errorlevel 3 exit /b 1
if errorlevel 2 goto update_extensions
if errorlevel 1 exit /b 1
set "NEURA=1"

rem Use the sealed unbundled CLI; never dispatch to stock/global Pi.
node "%NEURA_AGENT_DIR%\neura\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" --no-mcp --tui-mode regular %*
exit /b %errorlevel%

:update_extensions
set "NEURA=1"
node "%NEURA_AGENT_DIR%\neura\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" update --extensions --approve
exit /b %errorlevel%
