@echo off
title Transkrip Rapat AI
cd /d "%~dp0"

echo Membuka Aplikasi Transkrip Rapat AI...

if exist "C:\Users\alzha\AppData\Local\Programs\Python\Python310\python.exe" (
    "C:\Users\alzha\AppData\Local\Programs\Python\Python310\python.exe" main.py
) else (
    python main.py
)

if %errorlevel% neq 0 (
    echo.
    echo Terjadi kendala saat membuka aplikasi.
    pause
)
