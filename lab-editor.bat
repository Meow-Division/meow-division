@echo off
rem The map editor on the laboratory (live\map_lab.js): the same local server as map-editor.bat (port 8931, --editor), the editor opened on the lab.
cd /d "%~dp0"
netstat -ano | findstr ":8931 " | findstr LISTENING >nul || (start "Meow Division map editor (close to stop)" /min node server\server.mjs --port 8931 --editor & timeout /t 2 /nobreak >nul)
start "" "http://127.0.0.1:8931/live/index.html?editor&map=lab"
