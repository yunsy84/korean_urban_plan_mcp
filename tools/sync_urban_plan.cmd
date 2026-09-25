@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync_urban_plan.ps1" %*
if errorlevel 1 (
  echo.
  echo [SYNC FAILED]
  pause
  exit /b 1
)
echo.
echo [SYNC OK]
pause
