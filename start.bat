@echo off
cd /d "%~dp0"

start "" cmd /c "venv\Scripts\activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000"
start "" cmd /c "venv\Scripts\activate && cd react && npm run dev"
start http://localhost:3000