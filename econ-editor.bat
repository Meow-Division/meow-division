@echo off
rem The economy page: a local server that saves live\economy.js and the upgrade prices in live\data.js (port 8933, --editor),
rem then the page in the browser. A server already up on the port is used as it is.
cd /d "%~dp0"
curl -s -o nul http://127.0.0.1:8933/api/health && goto open
start "Meow Division economy page (close to stop)" /min node server\server.mjs --port 8933 --editor
timeout /t 2 /nobreak >nul
:open
start "" "http://127.0.0.1:8933/live/econ.html"
