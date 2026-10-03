@echo off
setlocal enabledelayedexpansion
rem ============================================================
rem  Microsoft Rewards Script - silent one-shot runner (bare metal)
rem
rem  Launched hidden by run-daily.vbs from the Windows Scheduled
rem  Task "MicrosoftRewardsScript" (triggers: at logon + daily).
rem  Runs every configured account once, then exits by itself.
rem
rem  Guards:
rem    * once per calendar day: a successful run, or three failed
rem      attempts, lock the rest of the day for further triggers; a failed
rem      run leaves the day open so a later trigger can retry it
rem    * only one instance at a time, via the lock file logs\run.lock
rem    * refuses to run while .env still holds the example account
rem    * memory aware: below 2.5 GB free RAM the run drops to a single
rem      cluster, because four headless Chromium instances on a paging
rem      machine crawl instead of running
rem    * watchdog (run-watchdog.bat, 150 min, REWARDS_RUN_TIMEOUT_MIN):
rem      a stalled run is killed and reported instead of holding the lock
rem      and never notifying
rem
rem  Manual use:  run-daily.bat        = real run
rem               run-daily.bat dry    = plumbing test, no network
rem ============================================================

set "ROOT=%~dp0..\.."
pushd "%ROOT%"
if not exist "logs" mkdir "logs"

set "LOG=logs\last-run.log"
set "RLOG=logs\runner.log"
set "STATE=logs\last-run.state"
set "MODE=real"
if /i "%~1"=="dry" set "MODE=dry"

rem --- date and clock (one Node call; PowerShell cold start costs 5-22s
rem     on this machine when memory is tight) ------------------------------
rem REALDAY = real calendar date, used for log timestamps only
rem TODAY   = logical day, used by the once-per-day guard and the state file.
rem   The logical day starts at 04:00 local: a run in the small hours belongs
rem   to the previous day, otherwise it marks the new day as handled and the
rem   post-boot trigger is skipped all day (that is exactly what happened on
rem   2026-09-24: a 02:19 run claimed the day, the 11:30 boot was skipped).
for /f "usebackq tokens=1,2,3" %%a in (`node "scripts\windows\run-state.js" clock`) do set "REALDAY=%%a" & set "TODAY=%%b" & set "CLOCK=%%c"

rem --- single instance guard -------------------------------------------------
rem 以“是否有 node 在跑 dist\index.js”为权威,而不是只看锁文件:
rem 上次被异常中断(崩溃/强杀/断电)时锁会残留,那种锁必须能立即回收,
rem 否则当天所有重试都会被挡掉。
set "ABNORMAL=0"
if exist "logs\run.lock" (
    set "LOCKSTATE=NONE"
    for /f "usebackq tokens=1" %%s in (`node "scripts\windows\run-state.js" lock-status`) do set "LOCKSTATE=%%s"
    if /i "!LOCKSTATE!"=="RUNNING" (
        echo [%REALDAY% %CLOCK%] another run is still in progress, skipped >> "%LOG%"
        popd
        exit /b 0
    )
    echo [%REALDAY% %CLOCK%] stale lock found ^(state=!LOCKSTATE!^), removing it >> "%RLOG%"
    del /q "logs\run.lock" >nul 2>&1
    set "ABNORMAL=1"
)
type nul > "logs\run.lock"

rem --- once-per-day guard -------------------------------------------------
rem 逻辑日(TODAY)以本地 04:00 为界:凌晨的补跑归前一天,否则它会把新的一天
rem 标成已完成,开机后的触发就被白白跳过(2026-09-24 的真实事故)。
set "RUNS=0"
if exist "%STATE%" for /f "usebackq tokens=1,2" %%a in ("%STATE%") do set "STATE_DAY=%%a" & set "STATE_N=%%b"
if "%STATE_DAY%"=="%TODAY%" set "RUNS=%STATE_N%"
if !RUNS! LSS 3 goto day_open

echo [%REALDAY% %CLOCK%] day %TODAY% already handled, attempts=%RUNS%, skipped >> "%LOG%"

rem 跳过也要说一声(否则用户只看到"开机后什么都没跑"):
rem 同一天只提醒一次,不然每两小时一条。
set "NOTIFIED=0"
if exist "logs\handled-skip.notified" findstr /c:"%TODAY%" "logs\handled-skip.notified" >nul 2>&1 && set "NOTIFIED=1"
if "!NOTIFIED!"=="1" goto handled_done
>"logs\handled-skip.notified" echo %TODAY%
node "wechat-bridge\notify-skip.js" handled %TODAY% >> "%RLOG%" 2>&1

:handled_done
del /q "logs\run.lock" >nul 2>&1
popd
exit /b 0

:day_open

rem --- credential guard, real runs only ----------------------------------
if /i "%MODE%"=="dry" goto creds_ok
if not exist ".env" goto no_creds
findstr /r /b /i "ACCOUNT_[0-9][0-9]*_EMAIL=email@example.com" ".env" >nul 2>&1
if not errorlevel 1 goto no_creds
findstr /r /b /i "ACCOUNT_[0-9][0-9]*_EMAIL=email_[0-9]" ".env" >nul 2>&1
if not errorlevel 1 goto no_creds
goto creds_ok

:no_creds
echo [%REALDAY% %CLOCK%] .env has no real account configured yet, run skipped >> "%LOG%"

rem 需要人工处理的情况必须说一声,否则用户只看到"什么都没跑"。同一天只提醒一次。
set "NOTIFIED=0"
if exist "logs\no-cred.notified" findstr /c:"%TODAY%" "logs\no-cred.notified" >nul 2>&1 && set "NOTIFIED=1"
if "!NOTIFIED!"=="1" goto no_creds_done
>"logs\no-cred.notified" echo %TODAY%
node "wechat-bridge\notify-skip.js" nocreds >> "%RLOG%" 2>&1

:no_creds_done
del /q "logs\run.lock" >nul 2>&1
popd
exit /b 0

:creds_ok
rem --- 内存闸门:内存不够就不启动(不消耗当天尝试次数,留给后面的触发) ------
rem 一次运行自己就要约 1 GB(单集群两个 headless Chromium)。内存被别人占满时
rem 硬跑只会爬行甚至卡死,所以宁可跳过;下一个触发(每 2 小时一次)再试。
if /i "%MODE%"=="dry" goto mem_ok
set "DECISION=2"
for /f "usebackq tokens=1" %%c in (`node "scripts\windows\run-config.js" decide`) do set "DECISION=%%c"
if /i not "!DECISION!"=="SKIP" goto mem_ok

set "FREE_MB=-1"
for /f "usebackq tokens=1" %%m in (`node "scripts\windows\run-state.js" free-mem`) do set "FREE_MB=%%m"
echo [%REALDAY% %CLOCK%] free memory !FREE_MB!MB is below the gate, run skipped ^(attempt not consumed^) >> "%RLOG%"

rem 同一天只提醒一次,免得每两小时一条。
rem 注意:提示文字里不能出现括号 —— 它会被 cmd 当成块的分隔符(踩过这个坑)。
set "NOTIFIED=0"
if exist "logs\mem-skip.notified" findstr /c:"%TODAY%" "logs\mem-skip.notified" >nul 2>&1 && set "NOTIFIED=1"
if "!NOTIFIED!"=="1" goto mem_skip_done
>"logs\mem-skip.notified" echo %TODAY%
node "wechat-bridge\notify-skip.js" !FREE_MB! >> "%RLOG%" 2>&1

:mem_skip_done
del /q "logs\run.lock" >nul 2>&1
popd
exit /b 0

:mem_ok
rem --- rotate log --------------------------------------------------------
if exist "%LOG%" move /y "%LOG%" "logs\previous-run.log" >nul 2>&1

set /a RUNS+=1

rem --- start notification, real runs only ---------------------------------
if not "%MODE%"=="dry" (
    if "!ABNORMAL!"=="1" (
        node "wechat-bridge\notify-start.js" --retry --day %TODAY% >> "%LOG%" 2>&1
    ) else (
        node "wechat-bridge\notify-start.js" --day %TODAY% >> "%LOG%" 2>&1
    )
)

rem dry 自检不写状态:它既不算一次尝试,也不锁定当天
if /i not "%MODE%"=="dry" >"%STATE%" echo !TODAY! !RUNS!

rem --- 内存自适应:内存吃紧时降到单集群 ----------------------------------
rem 两个集群会同时开 4 个 headless Chromium(每账号移动+桌面各一个)。
rem 本机内存常被其它进程占满(实测提交内存可到物理内存的 2 倍以上,大量换页),
rem 此时并行只会互相拖慢:整次运行会从 30 多分钟拖到几小时,甚至十几分钟静默卡死。
rem 上游的 CONFIG_CLUSTERS 环境变量在本版本里是死代码,所以直接改 config.json。
set "CLUSTERS=2"
set "FREE_MB=-1"
for /f "usebackq tokens=1" %%m in (`node "scripts\windows\run-state.js" free-mem`) do set "FREE_MB=%%m"
for /f "usebackq tokens=1" %%c in (`node "scripts\windows\run-config.js" clusters auto`) do set "CLUSTERS=%%c"

if /i "%MODE%"=="dry" goto dry_run

echo [%REALDAY% %CLOCK%] === run start, attempt !RUNS! of max 3 today === >> "%LOG%"
echo [%REALDAY% %CLOCK%] free memory !FREE_MB!MB -^> clusters=!CLUSTERS! >> "%LOG%"

rem --- 看门狗:卡死的运行会被强杀,以免占着锁又不出结果 ------------------
set "WATCHDOG_MIN=150"
if defined REWARDS_RUN_TIMEOUT_MIN set "WATCHDOG_MIN=%REWARDS_RUN_TIMEOUT_MIN%"
start "" /b cmd /c "scripts\windows\run-watchdog.bat !WATCHDOG_MIN!"

node "dist\index.js" >> "%LOG%" 2>&1
goto run_end

:dry_run
echo [%REALDAY% %CLOCK%] === dry run, no accounts contacted === >> "%LOG%"
echo [%REALDAY% %CLOCK%] free memory !FREE_MB!MB -^> clusters=!CLUSTERS! ^(dry, not applied^) >> "%LOG%"
node -e "console.log('dry run, no accounts contacted')" >> "%LOG%" 2>&1

:run_end
set "CODE=!ERRORLEVEL!"

rem --- classify the run ---------------------------------------------------
rem The script exits 0 even when a login or an account flow died, so the log is
rem scanned too: a successful run must show ACCOUNT-END or ACCOUNT-SKIP, and
rem any fatal marker downgrades the day to "failed" so that a later trigger
rem retries it (attempts are capped at 3 per day above).
set "DONE=0"
set "FAIL=0"
if /i "%MODE%"=="dry" set "DONE=1"
findstr /i /c:"[ACCOUNT-END]" "%LOG%" >nul 2>&1 && set "DONE=1"
findstr /i /c:"[ACCOUNT-SKIP]" "%LOG%" >nul 2>&1 && set "DONE=1"

if not "!CODE!"=="0" set "FAIL=1"
findstr /i /c:"flow failed for" "%LOG%" >nul 2>&1 && set "FAIL=1"
findstr /i /c:"[ACCOUNT-ERROR]" "%LOG%" >nul 2>&1 && set "FAIL=1"
findstr /i /c:"fatal error:" "%LOG%" >nul 2>&1 && set "FAIL=1"
findstr /i /c:"[CLUSTER-WORKER-ERROR]" "%LOG%" >nul 2>&1 && set "FAIL=1"
rem 被看门狗强杀的运行即使已经完成了部分账号,也不能算"当天完成":
rem 否则当天剩下的重试机会就没了,剩下的账号要等到明天。
findstr /i /c:"[WATCHDOG] run killed after" "%LOG%" >nul 2>&1 && set "FAIL=1"
if "!DONE!"=="0" set "FAIL=1"

if "!FAIL!"=="0" (
    rem dry 自检不锁定当天
    if /i not "%MODE%"=="dry" >"%STATE%" echo !TODAY! 9
    echo [%REALDAY% %CLOCK%] === run finished OK, exit code !CODE! === >> "%LOG%"
) else (
    echo [%REALDAY% %CLOCK%] === run finished with FAILURES, exit code !CODE! === >> "%LOG%"
    if "!CODE!"=="0" set "CODE=1"
)

rem --- notification fan-out (WeCom webhook / WeChat ClawBot) --------------
rem notify-run.js no-ops when a channel is unavailable; the run exit code is not affected.
node "wechat-bridge\notify-run.js" "%LOG%" >> "%LOG%" 2>&1

del /q "logs\run.lock" >nul 2>&1
popd
exit /b !CODE!
