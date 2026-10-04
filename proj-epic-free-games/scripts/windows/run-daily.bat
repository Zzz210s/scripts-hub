@echo off
rem Epic 限免领取:计划任务的入口。守卫都在这里先过一遍,不过就立刻退出。
rem 真正的判定在 node 里(scripts\windows\run-state.js 与 src\cli.js),这里只做取舍。
setlocal enabledelayedexpansion
cd /d "%~dp0..\.."
if not exist "logs" mkdir "logs"

rem 单实例:已有一次运行在跑就退出;崩溃留下的残锁会被 run-state.js 立即回收
for /f "usebackq delims=" %%s in (`node "scripts\windows\run-state.js" lock-status`) do set "LOCK=%%s"
if /i "!LOCK!"=="RUNNING" exit /b 0

rem 当日配额:今天已经真跑够次数就不起了
for /f "usebackq delims=" %%q in (`node "scripts\windows\run-state.js" quota`) do set "QUOTA=%%q"
if /i "!QUOTA!"=="MET" exit /b 0

rem 内存闸门:低于 800MB 就跳过,等下一次触发
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
