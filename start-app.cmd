@echo off
rem Starts the PROJECT S6 site (Vite on http://localhost:5173 + payments API on :3001).
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://localhost:5173/
call npm run dev
pause
