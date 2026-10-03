# 注册微信读书签到的计划任务(普通用户权限即可)
#
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
#
# 任务名:WeReadSignIn
#   - 登录后 10 分钟触发,其后 1 小时内每 10 分钟重复一次(与微软积分错峰:它 3 分钟)
#   - 每天 08:30 起每 60 分钟一次,持续 14 小时(与微软积分 08:00 错峰;关机时的触发会直接丢失,不补跑)
#   - 不唤醒机器(WakeToRun=false),错过后尽快启动(StartWhenAvailable=true)
# 卸载:Unregister-ScheduledTask -TaskName WeReadSignIn
#
# 用 XML 注册而不是 New-ScheduledTaskTrigger:登录触发器的 Delay 只能写成 PT3M,
# PowerShell 的 .Delay = TimeSpan 会序列化成 00:03:00,任务计划程序判定 XML 非法(0x80041318)。

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$vbs = Join-Path $root 'scripts\windows\run-daily.vbs'
$taskName = 'WeReadSignIn'
$userId = "$env:USERDOMAIN\$env:USERNAME"

if (-not (Test-Path $vbs)) { throw "找不到启动脚本:$vbs" }

# 08:30 起,与微软积分(08:00)错开半小时;登录延迟也错开(它 3 分钟,本程序 10 分钟)
$start = (Get-Date).Date.AddDays(1).AddHours(8).AddMinutes(30).ToString('yyyy-MM-ddTHH:mm:ss')

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>微信读书每日签到:按剩余进度跑阅读会话,并用官方 API 校验时长是否被计入</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$userId</UserId>
      <Delay>PT10M</Delay>
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
        <Interval>PT60M</Interval>
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
    <Enabled>true</Enabled>
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
$info = $task | Get-ScheduledTaskInfo
Write-Output ("任务已注册:{0} | State={1} | NextRun={2}" -f $taskName, $task.State, $info.NextRunTime)
