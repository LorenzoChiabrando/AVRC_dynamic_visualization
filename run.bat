@echo off
REM Create a local Python venv, install requirements, and serve the web viewer.
REM Usage: run.bat [port]   (default 8000). Re-run anytime; the venv is created only once.
REM To start from a clean setup, delete the .venv folder and run again.
setlocal
cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=8000"
set "VENV=.venv"

REM First run only: create the venv and install requirements.
if not exist "%VENV%\" (
  echo Creating virtual environment in %VENV% ...
  python -m venv "%VENV%"
  if errorlevel 1 (
    echo Could not create the venv. Is Python 3 installed and on PATH?
    exit /b 1
  )
  "%VENV%\Scripts\python.exe" -m pip install --upgrade pip
  REM Requirements are for the converter (convert.py); the viewer only needs the built-in web server.
  "%VENV%\Scripts\python.exe" -m pip install -r requirements.txt
)

set "URL=http://localhost:%PORT%/"
echo Serving the viewer at %URL%  (press Ctrl+C to stop)
start "" "%URL%"
"%VENV%\Scripts\python.exe" -m http.server %PORT% --directory web
endlocal
