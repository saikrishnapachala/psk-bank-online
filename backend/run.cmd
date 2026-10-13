@echo off
REM Builds and runs the banking service with only a JDK (21+).
REM Usage: run.cmd            start the service
REM        run.cmd --check    live-mode smoke test, then exit
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul && echo Created backend\.env from .env.example (mock mode).
if exist out rmdir /s /q out
dir /s /b src\*.java > sources.txt
javac -d out @sources.txt || exit /b 1
del sources.txt
java -cp out com.pskbank.demo.App %*
