@echo off
rem Epic free games: device-authorization login, once (renews itself, no password).
rem cd's to the project root first, so it is safe from any working directory.
rem NOTE: keep this file ASCII-only (see epic-run.bat for why).
rem   usage: epic-login.bat             device auth: print link + code, confirm in a browser
rem          epic-login.bat --browser   fallback: log in by hand in the opened browser
setlocal
cd /d "%~dp0..\.."
if "%~1"=="" (
  node "src\cli.js" login
) else (
  node "src\cli.js" login %*
)
exit /b %ERRORLEVEL%
