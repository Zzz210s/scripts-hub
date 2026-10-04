@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0..\.."
set "TIMEOUT_MIN=%WEREAD_RUN_TIMEOUT_MIN%"
if "%TIMEOUT_MIN%"=="" set "TIMEOUT_MIN=100"

for /f "usebackq delims=" %%t in (`node "scripts\windows\run-state.js" lock-mtime`) do set "LOCKT=%%t"

set /a ELAPSED=0
:loop
timeout /t 60 /nobreak >nul
set /a ELAPSED+=1
if !ELAPSED! GEQ %TIMEOUT_MIN% goto check
goto loop

:check
for /f "usebackq delims=" %%n in (`node "scripts\windows\run-state.js" lock-mtime`) do set "NOWT=%%n"
if not "!NOWT!"=="!LOCKT!" exit /b 0
echo [%DATE% %TIME%] watchdog: run exceeded %TIMEOUT_MIN% minutes, killing >> "logs\runner.log"
node "scripts\windows\run-state.js" kill >> "logs\runner.log" 2>&1
exit /b 0
