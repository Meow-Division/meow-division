@echo off
rem The players' market's treasury, treasury.meowdivision.near (docs/market.md): starts the page on this PC (port 8961)
rem and opens it. You connect the wallet of meowdivision.near (not HOT: it refuses full-access keys) and approve one
rem transaction there. Then: bash scripts/market-key.sh account treasury.meowdivision.near
cd /d "%~dp0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8961 " ^| findstr LISTENING') do taskkill /PID %%p /F >nul
start "Meow Division treasury (close to stop)" /min node scripts\treasury-launch.mjs
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8961/"
