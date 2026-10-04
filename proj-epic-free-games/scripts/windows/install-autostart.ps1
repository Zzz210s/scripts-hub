# 注册 Epic 限免领取的计划任务(普通用户权限即可)
#
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
#   Unregister-ScheduledTask -TaskName EpicFreeGames        # 卸载
#
# 这是**备用入口**。正规入口是合集层的调度配置:
#   node scripts/apply-schedule.mjs --dry-run     # 先看生成的触发器
#   node scripts/apply-schedule.mjs --apply --yes # 真注册
# 两者的时刻同源(config/schedule.json);改时间改那份配置,不要改这里。
#
# 任务默认注册成**禁用**状态:还没人工登录过一次浏览器时,启用它只会每天推「需要你处理」。
# 登录过之后启用:
#   Enable-ScheduledTask -TaskName EpicFreeGames
#
# 用 XML 而不是 New-ScheduledTaskTrigger:登录触发器的 Delay 只能写成 PT17M,
# PowerShell 的 .Delay = TimeSpan 会序列化成 00:17:00,任务计划程序判定 XML 非法(0x80041318)。

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$vbs = Join-Path $root 'scripts\windows\run-daily.vbs'
$taskName = 'EpicFreeGames'
$userId = "$env:USERDOMAIN\$env:USERNAME"

if (-not (Test-Path $vbs)) { throw "找不到启动脚本:$vbs" }

# 09:00 起(微软积分 08:00、微信读书 08:30 之后),登录后 17 分钟触发(与另两个错峰)
$start = (Get-Date).Date.AddDays(1).AddHours(9).ToString('yyyy-MM-ddTHH:mm:ss')

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Epic 限免领取:探测当期免费游戏,只有存在没领过的项才启动浏览器引擎</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$userId</UserId>
      <Delay>PT17M</Delay>
      <Repetition>
        <Interval>PT10M</Interval>
        <Duration>PT1H</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </LogonTrigger>
    <CalendarTrigger>
      <StartBoundary>$start</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
      <Repetition>
        <Interval>PT240M</Interval>
        <Duration>PT14H</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$userId</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT3H</ExecutionTimeLimit>
    <Enabled>false</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>"$vbs"</Arguments>
    </Exec>
  </Actions>
</Task>
"@

Register-ScheduledTask -TaskName $taskName -Xml $xml -Force | Out-Null
$task = Get-ScheduledTask -TaskName $taskName
Write-Output ("任务已注册:{0} | State={1}" -f $taskName, $task.State)
Write-Output '现在是禁用状态。人工登录过一次之后启用:Enable-ScheduledTask -TaskName EpicFreeGames'
