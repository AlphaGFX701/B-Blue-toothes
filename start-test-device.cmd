@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-test-device.ps1" %*
echo.
echo BLE test device has stopped. Press any key to close this window.
pause >nul
