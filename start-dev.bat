@echo off
setlocal

REM Start backend dev server in a new terminal window
start "OneGapo Backend" cmd /k "cd /d "%~dp0backend" && npm run dev"

REM Start frontend dev server in a new terminal window
start "OneGapo Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

endlocal
