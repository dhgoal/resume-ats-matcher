@echo off
cd /d "%~dp0"
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
if not exist "node_modules\electron" (
  echo Installing dependencies for the first time, please wait...
  call npm install --registry=https://registry.npmmirror.com
)
echo Launching Resume ATS Matcher...
call npm start
