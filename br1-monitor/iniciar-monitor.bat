@echo off
title BR1 Monitor de servidores
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0br1-monitor.ps1" %*
echo.
echo O monitor parou. Aperte uma tecla para fechar.
pause >nul
