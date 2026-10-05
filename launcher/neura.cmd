@echo off
title neura
rem Only Neura launch is guarded; invoking pi directly remains unchanged.
set "NEURA_AGENT_DIR=%USERPROFILE%\.pi\agent"
if defined PI_CODING_AGENT_DIR set "NEURA_AGENT_DIR=%PI_CODING_AGENT_DIR%"
call node "%NEURA_AGENT_DIR%\neura\runtime-install.mjs" check || exit /b 1
set "NEURA=1"

where pi >nul 2>&1 || (
  echo Neura requires Pi. Run: npm install -g @earendil-works/pi-coding-agent 1>&2
  exit /b 1
)
rem Preserve Neura's regular-terminal launch; plain Pi keeps its own default.
pi --tui-mode regular %*
