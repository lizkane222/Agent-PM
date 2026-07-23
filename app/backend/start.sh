#!/bin/sh
set -e
python manage.py migrate --noinput
python manage.py collectstatic --noinput --clear
exec daphne -b 0.0.0.0 -p "${PORT:-8000}" core.asgi:application
