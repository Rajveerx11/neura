@echo off
setlocal
rem Neura owns its runtime. Never resolve or launch Pi or read its profile.
if defined NEURA_SOURCE (set "NEURA_ROOT=%NEURA_SOURCE%") else (set "NEURA_ROOT=%~dp0..")
set "MASTRA_TELEMETRY_DISABLED=1"
node "%NEURA_ROOT%\src\cli.ts" %*
exit /b %ERRORLEVEL%
