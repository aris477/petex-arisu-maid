$ErrorActionPreference = "Stop"
$portableDir = $PSScriptRoot
$companionExe = Join-Path $portableDir "CodexPetCompanion.exe"
$disableFlag = Join-Path $portableDir "data\companion-disabled"
Remove-Item -LiteralPath $disableFlag -Force -ErrorAction SilentlyContinue
$startupDir = [Environment]::GetFolderPath("Startup")
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut((Join-Path $startupDir "Codex Pet Companion (Aris).lnk"))
$lnk.TargetPath = $companionExe
$lnk.WorkingDirectory = $portableDir
$lnk.WindowStyle = 7
$lnk.Description = "Auto-start Maid Aris desktop pet whenever official Codex Desktop App is running."
$lnk.Save()
Start-Process -FilePath $companionExe -WorkingDirectory $portableDir -WindowStyle Hidden
Write-Output "Enabled Codex Pet Companion startup shortcut and started background watcher."
