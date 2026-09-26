@echo off
rem Double-click this file to run the TPT Balaji Delux hotel server on this Windows PC.
rem Phones, iPads and other PCs on the same Wi-Fi then open the address shown below.
title TPT Balaji Delux hotel server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo   Download the LTS version from https://nodejs.org , install it,
  echo   then double-click start-server.bat again.
  echo.
  pause
  exit /b 1
)
echo.
echo   Keep this window open while the hotel is using the app.
echo   To stop the server, close this window or press Ctrl+C.
node server\server.js
echo.
echo   The server has stopped.
pause
