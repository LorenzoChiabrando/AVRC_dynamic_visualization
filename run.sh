#!/usr/bin/env bash
# Create a local Python venv, install requirements, and serve the web viewer.
# Usage: ./run.sh [port]   (default 8000). Re-run anytime; the venv is created only once.
# To start from a clean setup, delete the .venv folder and run again.
cd "$(dirname "$0")" || exit 1

PORT="${1:-8000}"
VENV=".venv"

# Pick a Python 3 interpreter.
if command -v python3 >/dev/null 2>&1; then PY=python3; else PY=python; fi

# First run only: create the venv and install requirements.
if [ ! -d "$VENV" ]; then
  echo "Creating virtual environment in $VENV ..."
  "$PY" -m venv "$VENV" || { echo "Could not create the venv. Is Python 3 installed?"; exit 1; }
  "$VENV/bin/python" -m pip install --upgrade pip
  # Requirements are for the converter (convert.py). The viewer itself only needs the built-in web
  # server, so a failure here is a warning, not a stop.
  "$VENV/bin/python" -m pip install -r requirements.txt \
    || echo "Warning: could not install requirements; the viewer still runs, but convert.py may not."
fi

URL="http://localhost:$PORT/"
echo "Serving the viewer at $URL  (press Ctrl+C to stop)"

# Best effort: open the browser shortly after the server starts.
( sleep 1; { xdg-open "$URL" || open "$URL"; } >/dev/null 2>&1 ) &

exec "$VENV/bin/python" -m http.server "$PORT" --directory web
