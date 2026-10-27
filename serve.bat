@echo off
REM Bio-Spectral Entity Analyzer — simple local server (Windows, v0.3)
REM Camera APIs require http://localhost (not file://)
REM All MediaPipe assets are local under vendor/ — no internet required.

cd /d "%~dp0"

where py >nul 2>&1
if %ERRORLEVEL%==0 (
  echo Starting server at http://localhost:8080
  echo Open that URL in Chrome. Press Ctrl+C to stop.
  py -m http.server 8080
  goto :eof
)

where python >nul 2>&1
if %ERRORLEVEL%==0 (
  echo Starting server at http://localhost:8080
  echo Open that URL in Chrome. Press Ctrl+C to stop.
  python -m http.server 8080
  goto :eof
)

echo Python was not found. Install Python 3, or run:
echo   npx --yes serve -l 8080
pause
