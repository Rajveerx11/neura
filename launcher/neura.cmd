@echo off
title neura
set "NEURA=1"

where pi >nul 2>&1 || (
  echo Neura requires Pi. Run: npm install -g @earendil-works/pi-coding-agent 1>&2
  exit /b 1
)
pi %*
