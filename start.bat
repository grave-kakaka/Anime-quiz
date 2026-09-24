@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PY=python
where py >nul 2>nul && set PY=py

start "" /b %PY% -c "import time,webbrowser;time.sleep(1.2);webbrowser.open('http://127.0.0.1:8756/play')"

echo.
echo   动漫答题放映器 启动了，浏览器会自动打开。
echo   用完之后, 直接关掉这个窗口就行。
echo.

%PY% server.py
pause
