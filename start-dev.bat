@echo off
setlocal

REM Start backend dev server in a new terminal window
start "OneGapo Backend" /D "%~dp0backend" cmd /k npm run dev

echo Waiting for backend readiness at http://localhost:5000/api/health ...

set "BACKEND_OK=0"
for /l %%I in (1,1,40) do (
	powershell -NoProfile -ExecutionPolicy Bypass -Command ^
		"try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:5000/api/health' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
	if not errorlevel 1 (
		set "BACKEND_OK=1"
		goto :start_frontend
	)
)

:start_frontend
if "%BACKEND_OK%"=="1" (
	echo Backend is ready. Starting frontend...
) else (
	echo Backend did not become ready within timeout. Starting frontend anyway.
	echo Open the backend terminal window to check startup errors.
)

start "OneGapo Frontend" /D "%~dp0frontend" cmd /k npm run dev

endlocal
