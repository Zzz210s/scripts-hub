@echo off
setlocal
rem ============================================================
rem  Registers the silent autostart task for Microsoft Rewards Script.
rem
rem  Triggers:  * at user logon + 3 min (network must be up)
rem             * every day at 08:00, then repeated every 2 hours for 14 hours
rem               (so a crashed / skipped run is retried the same day; the
rem                once-per-day guard in run-daily.bat makes repeats harmless)
rem  Action  :  wscript.exe scripts\windows\run-daily.vbs  (hidden window)
rem  Behaviour: runs each account once, then exits by itself. The runner
rem             itself enforces "at most one completed run per calendar day",
rem             so several logons a day do not repeat the work.
rem
rem  Re-runnable: overwrites the task. No administrator rights needed
rem  (schtasks /sc onlogon would require elevation, PowerShell does not).
rem ============================================================

set "TASK=MicrosoftRewardsScript"
set "ROOT=%~dp0..\.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
set "VBS=%ROOT%\scripts\windows\run-daily.vbs"

if not exist "%VBS%" (
    echo [ERROR] not found: %VBS%
    exit /b 1
)

set "MRS_VBS=%VBS%"

rem Note: the quotes around the script path are built with [char]34 because a
rem literal " cannot be embedded inside the PowerShell command line here.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "try {" ^
  "  $a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ([char]34 + $env:MRS_VBS + [char]34);" ^
  "  $t1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME; $t1.Delay='PT3M';" ^
  "  $t2 = New-ScheduledTaskTrigger -Daily -At '08:00';" ^
  "  $t2.Repetition = (New-ScheduledTaskTrigger -Once -At '08:00' -RepetitionInterval (New-TimeSpan -Hours 2) -RepetitionDuration (New-TimeSpan -Hours 14)).Repetition;" ^
  "  $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew;" ^
  "  Register-ScheduledTask -TaskName '%TASK%' -Action $a -Trigger @($t1,$t2) -Settings $s -Description 'Silent Microsoft Rewards run (hidden, one run per day, exits when done)' -Force | Out-Null;" ^
  "  Write-Host '[OK] task %TASK% registered';" ^
  "} catch { Write-Host ('[ERROR] ' + $_.Exception.Message); exit 1 }"

set "MRS_VBS="

if errorlevel 1 (
    echo [ERROR] failed to register task %TASK%
    exit /b 1
)

echo      action  : wscript.exe "%VBS%"
echo      triggers: at logon + 3 min ^| daily at 08:00, repeated every 2 h for 14 h ^| hidden window
echo      once-per-day guard lives in run-daily.bat (logs\last-run.state)
echo      verify  : schtasks /query /tn "%TASK%" /v /fo LIST
exit /b 0
