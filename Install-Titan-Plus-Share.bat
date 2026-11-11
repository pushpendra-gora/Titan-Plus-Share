@echo off
setlocal enabledelayedexpansion
title Titan Plus Share - Windows Installer

echo =======================================================
echo          TITAN PLUS SHARE - 1-CLICK INSTALLER
echo             Fast * Simple * Anywhere
echo =======================================================
echo.

set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"
set "EXE_PATH=%APP_DIR%\Titan-Plus-Share.exe"
set "ICON_PATH=%APP_DIR%\assets\app.ico"
set "SAVE_DIR=C:\Users\Public\Downloads\TitanPlusShare"

if not exist "%EXE_PATH%" (
    echo [ERROR] Titan-Plus-Share.exe not found in %APP_DIR%
    pause
    exit /b 1
)

echo [1/5] Creating default received files storage folder...
if not exist "%SAVE_DIR%" (
    mkdir "%SAVE_DIR%" 2>nul
)
echo       Saved to: %SAVE_DIR%

echo.
echo [2/5] Creating Desktop, Start Menu, and Send-To Shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desktop = [Environment]::GetFolderPath('Desktop'); $s1 = $ws.CreateShortcut(\"$desktop\Titan Plus Share.lnk\"); $s1.TargetPath = '%EXE_PATH%'; $s1.WorkingDirectory = '%APP_DIR%'; $s1.IconLocation = '%ICON_PATH%,0'; $s1.Description = 'Titan Plus Share - Fast * Simple * Anywhere'; $s1.Save(); $startMenu = [Environment]::GetFolderPath('Programs'); $s2 = $ws.CreateShortcut(\"$startMenu\Titan Plus Share.lnk\"); $s2.TargetPath = '%EXE_PATH%'; $s2.WorkingDirectory = '%APP_DIR%'; $s2.IconLocation = '%ICON_PATH%,0'; $s2.Description = 'Titan Plus Share'; $s2.Save(); $sendTo = [Environment]::GetFolderPath('SendTo'); $s3 = $ws.CreateShortcut(\"$sendTo\Titan Plus Share.lnk\"); $s3.TargetPath = '%EXE_PATH%'; $s3.WorkingDirectory = '%APP_DIR%'; $s3.IconLocation = '%ICON_PATH%,0'; $s3.Description = 'Share with Titan Plus Share'; $s3.Save(); Write-Host '      Desktop, Start Menu & Send-To Shortcuts created successfully!'"

echo.
echo [3/5] Registering Windows Explorer Right-Click 'Share with Titan Plus Share'...
reg add "HKCU\Software\Classes\*\shell\TitanPlusShare" /ve /d "Share with Titan Plus Share" /f >nul
reg add "HKCU\Software\Classes\*\shell\TitanPlusShare" /v "MUIVerb" /t REG_SZ /d "Share with Titan Plus Share" /f >nul
reg add "HKCU\Software\Classes\*\shell\TitanPlusShare" /v "Position" /t REG_SZ /d "Top" /f >nul
reg add "HKCU\Software\Classes\*\shell\TitanPlusShare" /v "Icon" /t REG_SZ /d "\"%ICON_PATH%\"" /f >nul
reg add "HKCU\Software\Classes\*\shell\TitanPlusShare\command" /ve /t REG_SZ /d "\"%EXE_PATH%\" \"%%1\"" /f >nul

reg add "HKCU\Software\Classes\Directory\shell\TitanPlusShare" /ve /d "Share with Titan Plus Share" /f >nul
reg add "HKCU\Software\Classes\Directory\shell\TitanPlusShare" /v "MUIVerb" /t REG_SZ /d "Share with Titan Plus Share" /f >nul
reg add "HKCU\Software\Classes\Directory\shell\TitanPlusShare" /v "Position" /t REG_SZ /d "Top" /f >nul
reg add "HKCU\Software\Classes\Directory\shell\TitanPlusShare" /v "Icon" /t REG_SZ /d "\"%ICON_PATH%\"" /f >nul
reg add "HKCU\Software\Classes\Directory\shell\TitanPlusShare\command" /ve /t REG_SZ /d "\"%EXE_PATH%\" \"%%1\"" /f >nul

reg add "HKCU\Software\Classes\AllFilesystemObjects\shell\TitanPlusShare" /ve /d "Share with Titan Plus Share" /f >nul
reg add "HKCU\Software\Classes\AllFilesystemObjects\shell\TitanPlusShare" /v "MUIVerb" /t REG_SZ /d "Share with Titan Plus Share" /f >nul
reg add "HKCU\Software\Classes\AllFilesystemObjects\shell\TitanPlusShare" /v "Position" /t REG_SZ /d "Top" /f >nul
reg add "HKCU\Software\Classes\AllFilesystemObjects\shell\TitanPlusShare" /v "Icon" /t REG_SZ /d "\"%ICON_PATH%\"" /f >nul
reg add "HKCU\Software\Classes\AllFilesystemObjects\shell\TitanPlusShare\command" /ve /t REG_SZ /d "\"%EXE_PATH%\" \"%%1\"" /f >nul
echo       Context menu and Send-To registered for all files and folders!

echo.
echo [4/5] Opening Windows Firewall for Mobile LAN Connection (Port 51733)...
netsh advfirewall firewall add rule name="Titan Plus Share (TCP 51733)" dir=in action=allow protocol=TCP localport=51733 >nul 2>&1
netsh advfirewall firewall add rule name="Titan Plus Share (UDP 41235)" dir=in action=allow protocol=UDP localport=41235 >nul 2>&1
echo       Firewall rules configured for seamless Wi-Fi phone transfers!

echo.
echo [5/5] Launching Titan Plus Share on your screen...
start "" "%EXE_PATH%"

echo.
echo =======================================================
echo          INSTALLATION COMPLETE AND READY TO USE!
echo =======================================================
echo  - Desktop Icon: Created on your Home Screen / Desktop
echo  - Right-Click: Right-click any file or folder to Share
echo  - Received Files: C:\Users\Public\Downloads\TitanPlusShare
echo =======================================================
echo.
exit /b 0
