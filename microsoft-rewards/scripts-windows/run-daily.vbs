Option Explicit
' ============================================================
'  Microsoft Rewards Script - hidden launcher
'  Starts scripts\windows\run-daily.bat with no visible window.
'  Used by the Windows Scheduled Task "MicrosoftRewardsScript".
'  Arguments are forwarded, so "wscript run-daily.vbs dry"
'  performs the silent plumbing test without contacting accounts.
' ============================================================
Dim fso, sh, root, bat, args, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
' ...\<project>\scripts\windows\run-daily.vbs -> project root
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
bat = root & "\scripts\windows\run-daily.bat"

args = ""
For i = 0 To WScript.Arguments.Count - 1
    args = args & " " & WScript.Arguments(i)
Next

sh.CurrentDirectory = root
sh.Run """" & bat & """" & args, 0, False
