@echo off
setlocal
title Titan Plus Share - Uninstaller

echo Removing shortcuts and context menu...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$desktop = [Environment]::GetFolderPath('Desktop'); Remove-Item \"$desktop\Titan Plus Share.lnk\" -ErrorAction SilentlyContinue; $startMenu = [Environment]::GetFolderPath('Programs'); Remove-Item \"$startMenu\Titan Plus Share.lnk\" -ErrorAction SilentlyContinue"

reg delete "HKCU\Software\Classes\*\shell\TitanPlusShare" /f >nul 2>&1
reg delete "HKCU\Software\Classes\Directory\shell\TitanPlusShare" /f >nul 2>&1

echo Titan Plus Share shortcuts and context menu removed successfully.
pause

