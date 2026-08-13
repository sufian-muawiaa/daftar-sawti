@echo off
chcp 65001 >nul
title دفتر الديون الصوتي - خادم محلي
echo ==================================================
echo   دفتر الديون الصوتي - جاري تشغيل الخادم المحلي...
echo ==================================================
echo.

where python >nul 2>nul
if %errorlevel%==0 (
    echo تم العثور على Python، جاري التشغيل عبره...
    python "%~dp0serve.py"
    goto :end
)

where python3 >nul 2>nul
if %errorlevel%==0 (
    echo تم العثور على Python3، جاري التشغيل عبره...
    python3 "%~dp0serve.py"
    goto :end
)

where node >nul 2>nul
if %errorlevel%==0 (
    echo لم يتم العثور على Python، جاري التشغيل عبر Node.js...
    cd /d "%~dp0"
    npx --yes serve . -l 5173
    goto :end
)

echo.
echo ==================================================
echo   لم يتم العثور على Python أو Node.js على جهازك.
echo   ثبّت أحدهما ثم أعد تشغيل هذا الملف:
echo     - Python:  https://www.python.org/downloads/
echo     - Node.js: https://nodejs.org/
echo.
echo   أو الأسهل: انشر مجلد app بالكامل مباشرة على
echo   https://app.netlify.com (اسحب وأفلت) بدون أي تثبيت.
echo ==================================================
pause
goto :eof

:end
pause
