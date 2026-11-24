@echo off
setlocal enabledelayedexpansion
title Titan Plus Share - Host Server & Desktop App
color 0b

echo ========================================================
echo                 TITAN PLUS SHARE 
echo             Fast * Simple * Anywhere
echo ========================================================
echo.

:: 1. Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed on this laptop!
    echo         Node.js is required to run Titan Plus Share server.
    echo.
    echo Please install Node.js (LTS version) from:
    echo   https://nodejs.org
    echo.
    set /p "OPEN_NODE=Open Node.js download page now? (Y/N): "
    if /i "!OPEN_NODE!"=="Y" (
        start https://nodejs.org
    )
    pause
    exit /b 1
)

:: 2. Auto-install server dependencies if missing
if not exist "%~dp0server\node_modules\" (
    echo [SETUP] First-time setup: Installing server dependencies...
    echo         (This only runs once, please wait a few seconds)
    echo.
    cd /d "%~dp0server"
    call npm install --omit=dev
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install server dependencies.
        pause
        exit /b 1
    )
    echo [SETUP] Server dependencies installed successfully!
    echo.
)

:: 3. Check and build frontend if dist is missing
if not exist "%~dp0frontend\dist\" (
    echo [SETUP] Building frontend interface...
    cd /d "%~dp0frontend"
    call npm install
    call npm run build
    echo.
)

:: 4. Start Host Server
echo [1/2] Starting Titan Plus Share Host Server...
cd /d "%~dp0server"

:: Check if server is already running on port 51733
curl -s http://127.0.0.1:51733/api/status >nul 2>&1
if %errorlevel% neq 0 (
    start /b "" node server.js
    
    :: Wait for server to become active
    set RETRIES=0
    :WAIT_LOOP
    timeout /t 1 /nobreak >nul
    curl -s http://127.0.0.1:51733/api/status >nul 2>&1
    if %errorlevel% neq 0 (
        set /a RETRIES+=1
        if !RETRIES! lss 15 goto WAIT_LOOP
    )
)

echo.
echo [2/2] Launching Titan Plus Share Application...
echo.
echo ========================================================
echo Titan Plus Share is ACTIVE on this laptop!
echo - Local Web App:  http://localhost:51733
echo - Android APK:    %~dp0Titan-Plus-Share.apk
echo ========================================================
echo.

:: 5. Launch Application Window (Edge App Mode -> Chrome App Mode -> Default Browser)
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

echo Application window opened successfully.
echo You can minimize this window (keep it open while sharing).
echo.
pause
