@echo off
node "%~dp0scripts\update.mjs" zh-CN
set "TETHER_UPDATE_EXIT=%ERRORLEVEL%"
if not "%TETHER_UPDATE_EXIT%"=="0" echo Update failed. See the error above.
pause
exit /b %TETHER_UPDATE_EXIT%
