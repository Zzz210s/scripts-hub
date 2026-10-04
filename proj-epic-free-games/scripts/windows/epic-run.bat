@echo off
rem Epic free games: run one real claim. Double-click works too.
rem cd's to the project root first, so it is safe from any working directory.
rem NOTE: keep this file ASCII-only. UTF-8 Chinese in a .bat is mis-parsed by
rem       cmd.exe under the default OEM codepage 936 (fragments run as commands).
rem   usage: epic-run.bat             one real claim
rem          epic-run.bat --dry-run   print what would be sent, no network, no browser
setlocal
cd /d "%~dp0..\.."
if "%~1"=="" (
  node "src\cli.js" run
) else (
  node "src\cli.js" run %*
)
exit /b %ERRORLEVEL%
