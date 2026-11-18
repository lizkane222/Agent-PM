"""
Purge AI conversation data: chat sessions (+ messages, tool calls), voice-call transcripts,
skill-run Console rows (+ staged data) and unused voice-launch hand-offs.

Dry run by default. Nothing is deleted without --commit, and without --older-than-days or
--user the command refuses to run (the AI_DATA_RETENTION_DAYS setting supplies the default
age; 0 means "no retention policy", so it does nothing).

    python manage.py purge_ai_data --older-than-days 90            # report only
    python manage.py purge_ai_data --older-than-days 90 --commit
    python manage.py purge_ai_data --user jdoe --commit            # everything of one user
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone


class Command(BaseCommand):
    help = "Delete AI chat sessions, voice transcripts and skill runs older than N days, or all of one user's."

    def add_arguments(self, parser):
        parser.add_argument("--older-than-days", type=int, default=None)
        parser.add_argument("--user", default=None, help="username; purge all of this user's AI data")
        parser.add_argument("--commit", action="store_true", help="actually delete (default is a dry run)")

    def handle(self, *args, **opts):
        from agents.models import AgentSession
        from realtime.models import VoiceSession
        from skills.models import SkillRun, VoiceLaunchContext

        days = opts["older_than_days"]
        if days is None and not opts["user"]:
            days = int(getattr(settings, "AI_DATA_RETENTION_DAYS", 0) or 0)
        if opts["older_than_days"] is not None and opts["older_than_days"] < 1:
            raise CommandError("--older-than-days must be at least 1.")
        if not opts["user"] and not days:
            raise CommandError("Give --older-than-days or --user (or set AI_DATA_RETENTION_DAYS).")

        cutoff = timezone.now() - timedelta(days=days) if days else None
        sessions = AgentSession.objects.all()
        voice = VoiceSession.objects.all()
        runs = SkillRun.objects.all()
        launches = VoiceLaunchContext.objects.all()
        if opts["user"]:
            user = get_user_model().objects.filter(username=opts["user"]).first()
            if user is None:
                raise CommandError(f"No such user: {opts['user']}")
            sessions, voice = sessions.filter(user=user), voice.filter(user=user)
            runs, launches = runs.filter(user=user), launches.filter(user=user)
        if cutoff:
            sessions = sessions.filter(updated_at__lt=cutoff)
            voice = voice.filter(created_at__lt=cutoff)
            runs = runs.filter(started_at__lt=cutoff)
            launches = launches.filter(created_at__lt=cutoff)

        counts = {"agent sessions": sessions.count(), "voice sessions": voice.count(),
                  "skill runs": runs.count(), "voice launch contexts": launches.count()}
        for label, n in counts.items():
            self.stdout.write(f"{label}: {n}")
        if not opts["commit"]:
            self.stdout.write("Dry run - nothing deleted. Re-run with --commit.")
            return
        # Sessions cascade to messages and tool calls; runs cascade to their events.
        sessions.delete()
        voice.delete()
        runs.delete()
        launches.delete()
        self.stdout.write(self.style.SUCCESS("Deleted."))
