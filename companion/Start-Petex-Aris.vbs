Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Environment("Process")("PEDEX_DATA_DIR") = dir & "\data"
sh.Run """" & dir & "\Petex.exe""", 1, False
