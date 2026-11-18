#!/bin/sh
# Stop every Celery worker and beat that belongs to THIS checkout, however it was started.
#
# Why this exists: `npm run agent-pm` used to run `pkill -f "$PWD/backend/.venv/bin/celery"`, which
# only matches a process started with that ABSOLUTE path. A worker/beat started with a relative
# `.venv/bin/celery` (e.g. `cd backend && .venv/bin/celery ...`) was never matched, so it kept
# running OLD code next to the new ones. Two beats fire every schedule twice, and an old worker
# without the "claim the row before the Google insert" guard inserted each dragged action item into
# Google a second time — the duplicate calendar blocks.
#
# It stays narrow, because the original app at "TWILIO - Agent PM" runs the very same module
# (`celery -A core.celery`) and must never be touched: a process is stopped only if its WORKING
# DIRECTORY is this checkout's app/backend. A bare `pkill celery` would hit the other app.
#
# Usage: stop-celery.sh [--dry-run]     (--dry-run only prints what it would stop)

DRY=0
[ "$1" = "--dry-run" ] && DRY=1

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$APP_DIR/backend"

stopped=0

for pid in $(pgrep -f "celery -A core" 2>/dev/null); do
  # The `sh -c` wrappers that launch these share the command line but not the cwd rule below;
  # they are harmless to stop too, but only when they too run from this backend directory.
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  [ "$cwd" = "$BACKEND_DIR" ] || continue
  if [ "$DRY" = 1 ]; then
    printf 'would stop celery pid %s (%s)\n' "$pid" "$cwd"
  else
    kill "$pid" 2>/dev/null && stopped=$((stopped + 1))
  fi
done

if [ "$DRY" = 0 ] && [ "$stopped" -gt 0 ]; then
  # Give workers a moment to finish the task they are on (SIGTERM = warm shutdown), then make
  # sure nothing from this checkout is left holding an old copy of the code.
  sleep 3
  for pid in $(pgrep -f "celery -A core" 2>/dev/null); do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    [ "$cwd" = "$BACKEND_DIR" ] && kill -9 "$pid" 2>/dev/null
  done
  printf 'stopped %s celery process(es) from %s\n' "$stopped" "$BACKEND_DIR"
fi
exit 0
