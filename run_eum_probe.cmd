@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo korean_urban_plan_mcp v0.3.1 EUM public probe
echo ============================================================
echo.

echo Node:
where node
if errorlevel 1 goto NODE_NOT_FOUND
node --version
if errorlevel 1 goto NODE_FAIL

echo.

set "PNU=%~1"
if not defined PNU set /p "PNU=Enter 19-digit PNU: "
if not defined PNU goto PNU_MISSING

echo Running probe...
echo PNU=%PNU%
echo ------------------------------------------------------------
node "%~dp0tests\eum_public_probe.js" "%PNU%"
set "EXITCODE=%ERRORLEVEL%"
echo ------------------------------------------------------------
echo Exit code=%EXITCODE%
echo.
if "%EXITCODE%"=="0" goto OK

echo Probe failed.
goto END

:OK
echo Probe finished successfully.
goto END

:NODE_NOT_FOUND
echo ERROR: node.exe was not found in PATH.
goto END

:NODE_FAIL
echo ERROR: node.exe could not be started.
goto END

:PNU_MISSING
echo ERROR: PNU was not supplied.
goto END

:END
echo.
pause
endlocal
exit /b %EXITCODE%
