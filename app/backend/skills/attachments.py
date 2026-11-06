"""Create skill attachments, filing them as account artifacts when an account is chosen."""

from __future__ import annotations

import mimetypes

from django.db.models import Q

from .extract import extract_text
from .models import AgentSkill, AgentSkillAttachment

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_ATTACHMENTS = 20


def _account_for(user, account_id):
    """An accounts.Account the user may file into, else None. Never trusts the id alone."""
    if not account_id:
        return None
    from accounts.models import Account

    qs = Account.objects.filter(pk=account_id)
    if not user.is_staff:
        qs = qs.filter(Q(team_members__user=user) | Q(admin_owner=user)).distinct()
    return qs.first()


def create_attachment(skill: AgentSkill, user, *, upload=None, url: str = "", name: str = "",
                      account_id=None) -> AgentSkillAttachment:
    if skill.attachments.count() >= MAX_ATTACHMENTS:
        raise ValueError(f"A skill can hold at most {MAX_ATTACHMENTS} attachments.")
    if not upload and not url:
        raise ValueError("Provide a file or a url.")
    if upload and upload.size > MAX_UPLOAD_BYTES:
        raise ValueError("That file is larger than 15 MB.")
    if url and not url.lower().startswith(("http://", "https://")):
        raise ValueError("url must be http(s).")

    account = _account_for(user, account_id)
    if account_id and account is None:
        raise ValueError("You are not on that account.")

    label = name or (upload.name if upload else url)
    text = ""
    mime = ""
    size = None
    if upload:
        raw = upload.read()
        upload.seek(0)
        text = extract_text(upload.name, raw)
        mime = upload.content_type or mimetypes.guess_type(upload.name)[0] or ""
        size = upload.size

    att = AgentSkillAttachment.objects.create(
        skill=skill, name=label[:300], file=upload or None, url=url, mime_type=mime[:100],
        file_size=size, text=text, uploaded_by=user,
    )

    if account is not None:
        from accounts.models import AccountArtifact

        artifact = AccountArtifact.objects.create(
            account=account, uploaded_by=user,
            artifact_type="file" if upload else "link", name=label[:300],
            url=url or (att.file.url if att.file else ""),
            mime_type=mime[:100], file_size=size,
            description=f"<p>Context document for the “{skill.name}” skill.</p>",
        )
        if upload:
            artifact.file.save(upload.name, upload, save=True)
        att.artifact = artifact
        att.save(update_fields=["artifact"])

    # Attachments feed the prompt, so a reviewed skill must be re-reviewed.
    from .views import AgentSkillViewSet

    AgentSkillViewSet._reset_if_reviewed(skill)
    return att
