Option Explicit
' ============================================================
'  Microsoft Rewards Script - hidden shutdown launcher
'  Starts scripts\windows\auto-shutdown.bat with no visible
'  window. Used by the Windows Scheduled Task "AutoShutdown0200".
'  Arguments are forwarded, so "wscript run-shutdown.vbs test"
'  logs and prints the command without shutting anything down.
' ============================================================
Dim fso, sh, root, bat, args, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
' ...\<project>\scripts\windows\run-shutdown.vbs -> project root
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
bat = root & "\scripts\windows\auto-shutdown.bat"

args = ""
For i = 0 To WScript.Arguments.Count - 1
    args = args & " " & WScript.Arguments(i)
Next

sh.CurrentDirectory = root
sh.Run """" & bat & """" & args, 0, False
