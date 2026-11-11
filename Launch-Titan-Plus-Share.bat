@echo off
title Titan Plus Share - PC Application & Host Server
color 0b

echo ========================================================
echo               TITAN PLUS SHARE (BLUE EDITION)
echo                  Fast * Simple * Anywhere
echo ========================================================
echo.

:: Check if server is already running
curl -s http://localhost:51733/api/status >nul 2>&1
if %errorlevel% neq 0 (
    echo Starting Host Server on port 51733...
    cd /d "%~dp0\server"
    start /b "" node server.js
    timeout /t 2 /nobreak >nul
) else (
    echo Host Server is already active on port 51733.
)

echo.
echo Launching Titan Plus Share Desktop Application...
echo.

:: Try opening as standalone native app window via MS Edge or Chrome
where msedge >nul 2>&1
if %errorlevel% equ 0 (
    start msedge --app=http://localhost:51733 --window-size=1080,720
) else (
    where chrome >nul 2>&1
    if %errorlevel% equ 0 (
        start chrome --app=http://localhost:51733 --window-size=1080,720
    ) else (
        start http://localhost:51733
    )
)

echo ========================================================
echo Titan Plus Share is ACTIVE!
echo - Web & App: http://localhost:51733
echo - Android APK: %~dp0Titan-Plus-Share.apk
echo - Right-Click Context Menu: Run Add-To-Windows-Context-Menu.bat
echo ========================================================
echo (Keep this window open or minimize it)
echo.
pause
