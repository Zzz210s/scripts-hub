@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0..\.."
if not exist "logs" mkdir "logs"

rem single instance: a stale lock (crash/power loss) is reclaimed immediately
for /f "usebackq delims=" %%s in (`node "scripts\windows\run-state.js" lock-status`) do set "LOCK=%%s"
if /i not "!LOCK!"=="NONE" exit /b 0

rem quota guard: today already met -> do nothing
for /f "usebackq delims=" %%q in (`node "scripts\windows\run-state.js" quota`) do set "QUOTA=%%q"
if /i "!QUOTA!"=="MET" exit /b 0

rem memory guard: too little free RAM -> skip, next trigger will retry
for /f "usebackq delims=" %%m in (`node "scripts\windows\run-state.js" free-mem`) do set "FREEMEM=%%m"
if !FREEMEM! LSS 600 (
  node "src
otify-skip.js" low-memory !FREEMEM! >> "logsunner.log" 2>&1
  exit /b 0
)

if exist "logs\last-run.log" move /y "logs\last-run.log" "logs\previous-run.log" >nul

node "scripts\windows\run-state.js" lock
start "" /b cmd /c call "%~dp0run-watchdog.bat"
node "src\index.js" run >> "logs\last-run.log" 2>&1
set "CODE=!ERRORLEVEL!"
node "scripts\windows\run-state.js" unlock
exit /b !CODE!
