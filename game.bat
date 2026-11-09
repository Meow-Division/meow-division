@echo off
rem The game on this PC for testing: stops whatever listens on 8950, starts the local server there with the current code
rem (progress in server\data), then opens the game with the test keys (?dev) and the intro on every PLAY of mission 1 (?intro).
rem Test keys: F1 a level, F2 +60 s, F3 god mode, F4 a horde, F5 the next boss, P freeze, [ ] slower / back to normal.
rem A fresh start (mission 1 again): open the link in a private window.
cd /d "%~dp0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8950 " ^| findstr LISTENING') do taskkill /PID %%p /F >nul
timeout /t 1 /nobreak >nul
start "Meow Division local server (close to stop)" /min node server\server.mjs --port 8950
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8950/live/index.html?dev&intro"
