@echo off
setlocal
set "ROOT=%~dp0"
if not exist "%ROOT%dist\index.html" (
  echo dist\index.html was not found. Building first...
  call "%ROOT%build-standalone.bat"
  if errorlevel 1 exit /b %errorlevel%
)
start "" "%ROOT%dist\index.html"
endlocal
