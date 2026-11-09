$ErrorActionPreference = "Continue"
$portableDir = $PSScriptRoot
$disableFlag = Join-Path $portableDir "data\companion-disabled"
Set-Content -LiteralPath $disableFlag -Value "disabled" -Encoding UTF8
$startupLnk = Join-Path ([Environment]::GetFolderPath("Startup")) "Codex Pet Companion (Aris).lnk"
Remove-Item -LiteralPath $startupLnk -Force -ErrorAction SilentlyContinue
Get-Process -Name "CodexPetCompanion" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output "Disabled Codex Pet Companion startup."
