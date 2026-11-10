@echo off
rem The map editor: a local server that saves live\map.js (port 8931, --editor), then the editor in the browser.
cd /d "%~dp0"
start "Meow Division map editor (close to stop)" /min node server\server.mjs --port 8931 --editor
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8931/live/index.html?editor"
