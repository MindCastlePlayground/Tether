@echo off
setlocal DisableDelayedExpansion
set "TETHER_EXIT=1"
set "TETHER_PAUSE="
set "TETHER_CP="
rem chcp output is localized; its last word is the code page number, sometimes followed by a dot.
for /f "tokens=*" %%c in ('chcp') do for %%n in (%%c) do for /f "delims=." %%d in ("%%n") do set "TETHER_CP=%%d"
rem The wizard draws Unicode box characters and Chinese text; restore the caller's code page on exit.
chcp 65001 >nul 2>&1
if "%~1"=="" (
  set "TETHER_PAUSE=1"
  title Tether Installer
)
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Tether: Install Node.js 22 or newer from https://nodejs.org/ and reopen this installer.
  goto finish
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Tether: Node.js 22 or newer is required. Upgrade Node.js and retry.
  goto finish
)
pushd "%~dp0"
if errorlevel 1 (
  echo Tether: Cannot open the installer directory.
  goto finish
)
node -e "require.resolve('jsonc-parser'); require.resolve('smol-toml'); require.resolve('@clack/prompts')" >nul 2>&1
if not errorlevel 1 goto ready
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo Tether: npm is missing. Reinstall the standard Node.js distribution.
  popd
  goto finish
)
echo Tether: Installing CLI dependencies...
if exist package-lock.json (
  call npm.cmd ci --ignore-scripts --no-audit --no-fund
) else (
  call npm.cmd install --ignore-scripts --no-audit --no-fund
)
if errorlevel 1 (
  echo Tether: Dependency installation failed. Check the npm error above and your network, then retry.
  popd
  goto finish
)
:ready
popd
node "%~dp0bin\tether.mjs" %*
set "TETHER_EXIT=%ERRORLEVEL%"
:finish
if defined TETHER_PAUSE pause
if defined TETHER_CP chcp %TETHER_CP% >nul 2>&1
exit /b %TETHER_EXIT%
