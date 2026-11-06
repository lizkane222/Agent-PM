#!/bin/sh
# Stop the optional voice-testing processes this project starts, and nothing else.
#
#   * the Node voice relay on :8765 (app/voice-relay-server)
#   * the Cloudflare quick tunnels pointed at :8000 and :8765
#
# They are only needed for phone-call voice. They do not talk to Google and cannot email anyone,
# but a forgotten tunnel keeps a public URL pointing at this machine, so `npm run agent-pm`
# clears them. It is deliberately narrow — a process killer must never be wrong:
#
#   * the relay is found by WHAT IS LISTENING ON THE PORT, then only killed if its working
#     directory is this project's voice-relay-server. `pkill -f "node server.js"` would also
#     hit any other Node project's server.js on the machine.
#   * tunnels are matched by their exact `--url http://127.0.0.1:<port>` argument, never by a
#     bare `pkill cloudflared` (which would kill tunnels belonging to other projects).
#
# Usage: stop-voice-stack.sh [--dry-run]     (--dry-run only prints what it would stop)

DRY=0
[ "$1" = "--dry-run" ] && DRY=1

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELAY_DIR="$APP_DIR/voice-relay-server"
RELAY_PORT="${VOICE_RELAY_PORT:-8765}"
DJANGO_PORT="${DJANGO_PORT:-8000}"

stopped=0

say() { printf '%s\n' "$*"; }

kill_pid() {
  # $1 = pid, $2 = description
  if [ "$DRY" = 1 ]; then say "[dry-run] would stop $2 (pid $1)"; stopped=$((stopped + 1)); return; fi
  kill "$1" 2>/dev/null
  i=0
  while kill -0 "$1" 2>/dev/null && [ $i -lt 20 ]; do sleep 0.1; i=$((i + 1)); done
  if kill -0 "$1" 2>/dev/null; then kill -9 "$1" 2>/dev/null; fi
  say "stopped $2 (pid $1)"
  stopped=$((stopped + 1))
}

# --- the relay, identified by port + working directory ------------------------------------------
relay_pid="$(lsof -nP -iTCP:"$RELAY_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)"
if [ -n "$relay_pid" ]; then
  cwd="$(lsof -a -p "$relay_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  if [ "$cwd" = "$RELAY_DIR" ]; then
    kill_pid "$relay_pid" "voice relay on :$RELAY_PORT"
  else
    say "left alone: something else is listening on :$RELAY_PORT (pid $relay_pid, cwd ${cwd:-unknown}) — not this project's relay"
  fi
fi

# --- the tunnels, identified by their exact target ----------------------------------------------
for port in "$DJANGO_PORT" "$RELAY_PORT"; do
  for pid in $(pgrep -f "cloudflared tunnel .*--url http://127.0.0.1:$port\$" 2>/dev/null); do
    kill_pid "$pid" "cloudflared tunnel to :$port"
  done
done

[ "$stopped" = 0 ] && say "no voice relay or tunnels were running"
exit 0
