Set shell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = scriptDir & "\..\.."
shell.Run """" & scriptDir & "\run-daily.bat""", 0, False
