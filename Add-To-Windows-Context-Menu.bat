@echo off
setlocal
title Add Titan Plus Share to Windows Context Menu and Send-To

set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"
set "EXE_PATH=%APP_DIR%\Titan-Plus-Share.exe"
set "ICON_PATH=%APP_DIR%\assets\app.ico"

echo Registering Titan Plus Share in Windows Context Menu and Send-To...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $sendTo = [Environment]::GetFolderPath('SendTo'); $s = $ws.CreateShortcut(\"$sendTo\Titan Plus Share.lnk\"); $s.TargetPath = '%EXE_PATH%'; $s.WorkingDirectory = '%APP_DIR%'; $s.IconLocation = '%ICON_PATH%,0'; $s.Description = 'Share with Titan Plus Share'; $s.Save();"

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

echo Done! Titan Plus Share is registered in:
echo 1. Right-Click "Share with Titan Plus Share"
echo 2. Right-Click "Send to -> Titan Plus Share"
ping 127.0.0.1 -n 2 >nul
