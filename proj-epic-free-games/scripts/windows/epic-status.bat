@echo off
rem Epic free games: local status, token status, current free list -- no login needed.
rem cd's to the project root first, so it is safe from any working directory.
rem NOTE: keep this file ASCII-only (see epic-run.bat for why).
rem   usage: epic-status.bat          local state and today's attempt count
rem          epic-status.bat probe    current and upcoming free games
rem          epic-status.bat auth     token validity and expiry
setlocal
cd /d "%~dp0..\.."
if "%~1"=="" (
  node "src\cli.js" status
) else (
  node "src\cli.js" %*
)
exit /b %ERRORLEVEL%
