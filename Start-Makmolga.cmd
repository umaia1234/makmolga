@echo off
setlocal
chcp 65001 >nul
title MAKMOLGA
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1"
if errorlevel 1 (
  echo.
  echo 맠몰가를 시작하지 못했습니다. 위의 오류 안내를 확인해 주세요.
  pause
)
endlocal
