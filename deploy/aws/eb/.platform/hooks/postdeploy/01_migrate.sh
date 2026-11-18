#!/bin/bash
# Runs AFTER secrets exist (predeploy). Single-instance only: with several instances this
# would race, so add a leader check before scaling out.
set -euo pipefail
set -a; source /opt/elasticbeanstalk/deployment/env; set +a
source /var/app/venv/*/bin/activate
cd /var/app/current
mkdir -p "${DJANGO_MEDIA_ROOT:-/var/app/media}"
python manage.py migrate --noinput
