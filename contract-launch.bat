@echo off
rem The items contract's mainnet launch (contract/mainnet/DEPLOY.md): starts the helper on this PC (port 8960) and opens its page.
rem You connect the wallet of meowdivision.near and approve two prompts there; the helper does the rest.
cd /d "%~dp0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8960 " ^| findstr LISTENING') do taskkill /PID %%p /F >nul
start "Meow Division contract launch (close to stop)" /min node scripts\chain-launch.mjs
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8960/"
