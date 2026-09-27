@echo off
title Video Downloader
cd /d "%~dp0"
start "" http://127.0.0.1:8734
node server.mjs
echo.
echo Server stopped. Press any key to close this window...
pause >nul
