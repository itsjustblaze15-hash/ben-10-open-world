#!/bin/bash
# Double-click this file (first time: right-click -> Open) to run the Ben 10 character test.
cd "$(dirname "$0")"
PORT=8000
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done
URL="http://localhost:$PORT/index.html"
echo "Ben 10 character test running at $URL   (close this window or press Ctrl+C to stop)"
( sleep 1; open "$URL" ) &
if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server $PORT
elif command -v python >/dev/null 2>&1; then exec python -m SimpleHTTPServer $PORT
elif command -v npx >/dev/null 2>&1; then exec npx --yes serve -l $PORT .
else echo "No Python or Node found. Install Python 3 from python.org, then run this again."; read -r; fi
