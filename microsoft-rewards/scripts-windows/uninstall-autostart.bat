@echo off
setlocal
rem Removes the silent autostart task created by install-autostart.bat
set "TASK=MicrosoftRewardsScript"
schtasks /delete /f /tn "%TASK%"
if errorlevel 1 (
    echo [ERROR] task "%TASK%" could not be deleted (already absent?)
    exit /b 1
)
echo [OK] task "%TASK%" removed.
exit /b 0
