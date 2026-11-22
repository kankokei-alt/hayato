@echo off
rem Double-click to start Hayato (Windows)
chcp 65001 > nul
cd /d "%~dp0"
if not exist node_modules call npm install
npm start
pause
