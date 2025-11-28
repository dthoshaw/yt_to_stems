#!/bin/bash

# Get the directory where the script is located
cd "$(dirname "$0")"

# Open browser to the React app
open http://localhost:3000

# Start backend (FastAPI/Uvicorn) in a new terminal tab/window
osascript -e 'tell app "Terminal"
    do script "cd \""'"$PWD"'"\" && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000"
end tell'

# Start frontend (React) in another terminal tab/window
osascript -e 'tell app "Terminal"
    do script "cd \""'"$PWD/react"'"\" && npm run dev"
end tell'