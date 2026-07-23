# This file is intentionally empty — it marks this directory as a Python package.
# Celery app is imported here so Django's autoreload picks it up.
from .celery import app as celery_app

__all__ = ("celery_app",)
