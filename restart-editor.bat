@echo off
rem Restarts the map editor's local server (port 8931) with the current code: stops what listens on 8931, starts it again.
rem The open editor tab keeps its map: press Save in it again afterwards. (Desktop shortcut calls this file.)
cd /d "%~dp0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8931 " ^| findstr LISTENING') do taskkill /PID %%p /F >nul
timeout /t 1 /nobreak >nul
start "Zombie Horde map editor (close to stop)" /min node server\server.mjs --port 8931 --editor
timeout /t 2 /nobreak >nul
echo.
echo   Editor server restarted. Go back to the map tab and press Save.
echo.
pause
