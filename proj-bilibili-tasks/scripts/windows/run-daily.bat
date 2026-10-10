@echo off
rem Bilibili tasks: entry for the Windows scheduled task.
rem Guards are checked first here; the real decisions live in node (run-state.js and src\cli.js).
setlocal enabledelayedexpansion
cd /d "%~dp0..\.."
if not exist "logs" mkdir "logs"

rem single instance: bail out if a run is already going; stale locks are reclaimed by run-state.js
for /f "usebackq delims=" %%s in (`node "scripts\windows\run-state.js" lock-status`) do set "LOCK=%%s"
if /i "!LOCK!"=="RUNNING" exit /b 0

rem daily quota: do not start again if we already ran enough times today
for /f "usebackq delims=" %%q in (`node "scripts\windows\run-state.js" quota`) do set "QUOTA=%%q"
if /i "!QUOTA!"=="MET" exit /b 0

rem memory guard: skip below 800MB and wait for the next trigger
for /f "usebackq delims=" %%m in (`node "scripts\windows\run-state.js" free-mem`) do set "FREEMEM=%%m"
if !FREEMEM! LSS 800 (
  echo %DATE% %TIME% skip=low-memory free=!FREEMEM!MB >> "logs\runner.log"
  exit /b 0
)

if exist "logs\last-run.log" move /y "logs\last-run.log" "logs\previous-run.log" >nul

node "scripts\windows\run-state.js" lock
node "src\cli.js" run >> "logs\last-run.log" 2>&1
set "CODE=!ERRORLEVEL!"
node "scripts\windows\run-state.js" unlock
exit /b !CODE!
