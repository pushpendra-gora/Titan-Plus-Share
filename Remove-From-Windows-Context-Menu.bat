@echo off
title Remove Titan Plus Share from Windows Context Menu
color 0c

reg delete "HKCU\Software\Classes\*\shell\TitanPlusShare" /f >nul 2>&1
reg delete "HKCU\Software\Classes\Directory\shell\TitanPlusShare" /f >nul 2>&1

echo "Share with Titan Plus Share" removed from Windows Context Menu.
pause

