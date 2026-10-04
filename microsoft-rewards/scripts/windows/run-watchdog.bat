@echo off
setlocal enabledelayedexpansion
rem ============================================================
rem  Microsoft Rewards Script - run watchdog
rem
rem  Started in the background by run-daily.bat right before the
rem  real run. When the deadline passes and the very same run is
rem  still alive, it kills the whole process tree and writes a
rem  marker line into logs\last-run.log.
rem
rem  Why: the script can stall for hours (page timeouts, heavy
rem  paging on a loaded machine). Without a watchdog it keeps the
rem  lock, never reaches the result notification, and the day's
rem  retries are blocked.
rem
rem  Args: %1 = timeout in minutes (default 120, override with
rem        the REWARDS_RUN_TIMEOUT_MIN environment variable).
rem ============================================================

set "ROOT=%~dp0..\.."
pushd "%ROOT%"

set "MIN=%~1"
if not defined MIN set "MIN=150"
set "HELPER=node scripts\windows\run-state.js"

rem 记录启动时那把锁的时间戳:只有"同一次运行"还活着才动手,
rem 否则会把后面重试的另一次运行误杀。
set "TOKEN=-1"
for /f "usebackq tokens=1" %%t in (`%HELPER% lock-mtime`) do set "TOKEN=%%t"

set /a LEFT=MIN*2
:loop
if !LEFT! LEQ 0 goto fire
ping -n 31 127.0.0.1 >nul 2>&1
set /a LEFT-=1
goto loop

:fire
set "NOW=-1"
for /f "usebackq tokens=1" %%t in (`%HELPER% lock-mtime`) do set "NOW=%%t"
if not "!NOW!"=="!TOKEN!" (
    rem 这次运行早已结束,或者已经换成新的一次运行 —— 都不该动它
    popd
    exit /b 0
)

set "ST=NONE"
for /f "usebackq tokens=1" %%s in (`%HELPER% lock-status`) do set "ST=%%s"
if /i not "!ST!"=="RUNNING" (
    popd
    exit /b 0
)

rem 杀掉并复核:本机内存吃紧时 PowerShell 查询可能超时或返回空,
rem 所以最多试 3 轮,每轮 20 秒间隔,并把"是否还有残留"写进日志。
set /a ROUND=0
set /a TOTAL=0
set "LEFT_OVER=-1"
:kill_loop
set /a ROUND+=1
set "N=0"
for /f "usebackq tokens=1" %%k in (`%HELPER% kill`) do set "N=%%k"
set /a TOTAL+=N
set "LEFT_OVER=-1"
for /f "usebackq tokens=1" %%c in (`%HELPER% count`) do set "LEFT_OVER=%%c"
if !LEFT_OVER! LEQ 0 goto killed_done
if !ROUND! GEQ 3 goto killed_done
ping -n 21 127.0.0.1 >nul 2>&1
goto kill_loop

:killed_done
if !LEFT_OVER! LEQ 0 (
    echo [WATCHDOG] run killed after %MIN% minutes ^(killed=!TOTAL!^) >> "logs\last-run.log"
) else (
    echo [WATCHDOG] run killed after %MIN% minutes ^(killed=!TOTAL!, remaining=!LEFT_OVER!^) >> "logs\last-run.log"
)

popd
exit /b 0
