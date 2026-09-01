@echo off
setlocal

cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo npm was not found.
  echo Reinstall Node.js with npm, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing project dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo The .env file is missing.
  echo Copy .env.example to .env and add OPENAI_API_KEY before running.
  pause
  exit /b 1
)

echo Starting Windows Overlay Assistant...
call npm.cmd run dev

if errorlevel 1 (
  echo.
  echo The application stopped with an error.
  pause
  exit /b 1
)

endlocal
