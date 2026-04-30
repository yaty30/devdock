@echo off
cd /d "%~dp0"

rmdir /S /Q "dist" 2>nul
rmdir /S /Q "build" 2>nul
del /F /Q "Dashboard.spec" 2>nul

pyinstaller ^
  --onefile ^
  --windowed ^
  --name Dashboard ^
  --icon=app.ico ^
  --add-data "splash.png;." ^
  --add-data "app.ico;." ^
  app.py

copy /Y "app.config" "dist\app.config" >nul 2>nul
