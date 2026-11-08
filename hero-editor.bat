@echo off
rem The character editor: a local server that saves live\hero.js and the muzzles in live\data.js (port 8932, --editor), then the
rem editor in the browser. A server already up on the port is used as it is.
cd /d "%~dp0"
curl -s -o nul http://127.0.0.1:8932/api/health && goto open
start "Zombie Horde character editor (close to stop)" /min node server\server.mjs --port 8932 --editor
timeout /t 2 /nobreak >nul
:open
start "" "http://127.0.0.1:8932/live/index.html?hero"
