@echo off
setlocal
rem ============================================================
rem  Daily 02:00 real shutdown - unconditional
rem
rem  Launched hidden by run-shutdown.vbs from the Windows
rem  Scheduled Task "AutoShutdown0200" (daily 02:00, wake the
rem  computer to run it, never started late if the trigger was
rem  missed). Purpose: the machine otherwise only sleeps, so it
rem  keeps running with days of accumulated memory pressure;
rem  a real power-off at 02:00 gives a clean state every morning
rem  and the rewards job then runs on the next boot.
rem
rem  Deliberately unconditional: it does not wait for a running
rem  rewards job. It does keep a 60 second grace period before the
rem  machine goes down, so a pending shutdown can still be cancelled
rem  with "shutdown /a" during that minute.
rem
rem  Manual use:  auto-shutdown.bat        = log then shut down
rem               auto-shutdown.bat test   = log + print only, no shutdown
rem ============================================================

set "ROOT=%~dp0..\.."
pushd "%ROOT%"
if not exist "logs" mkdir "logs"

for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%d"
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format HH:mm:ss"') do set "CLOCK=%%t"

echo [%TODAY% %CLOCK%] shutdown scheduled ^(unconditional, 60s grace^) >> "logs\shutdown.log"

if /i "%~1"=="test" (
    echo [%TODAY% %CLOCK%] TEST mode: would run "shutdown /s /f /t 60" >> "logs\shutdown.log"
    echo test mode: shutdown /s /f /t 60
    popd
    exit /b 0
)

shutdown /s /f /t 60 /c "Daily 02:00 auto shutdown - run shutdown /a within 60s to cancel"

popd
exit /b 0
