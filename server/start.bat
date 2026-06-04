@echo off
REM ===== DiscoverDisc - one-click launcher (Windows) =====
cd /d "%~dp0"

echo.
echo   Starting DiscoverDisc...
echo.

REM Install dependencies the first time only
if not exist "node_modules" (
  echo   First run - installing dependencies, please wait...
  call npm install --no-audit --no-fund
  echo.
)

REM Open the site in the default browser, then start the server
start "" "http://localhost:4000"
node server.js

pause
