"""
Celery tasks for the sync review queue.

run_agent_review  — scores pending_agent items via Claude on Bedrock, auto-accepts
                    high-confidence matches, routes ambiguous ones to human review.
run_mismatch_analysis — triggered after an account_owner approves a delete request;
                         analyses why the item was mis-matched and suggests rule updates.
"""

import json
import logging

from celery import shared_task
from django.conf import settings

logger = logging.getLogger(__name__)

HIGH_CONFIDENCE = 0.90
LOW_CONFIDENCE = 0.50


def _bedrock_client():
    import boto3
    profile = settings.AWS_PROFILE or None
    region = settings.AWS_REGION or "us-west-2"
    session = boto3.Session(profile_name=profile)
    return session.client("bedrock-runtime", region_name=region)


def _call_claude(prompt: str) -> str:
    client = _bedrock_client()
    body = json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": prompt}],
    })
    response = client.invoke_model(
        modelId="anthropic.claude-sonnet-4-5",
        contentType="application/json",
        accept="application/json",
        body=body,
    )
    result = json.loads(response["body"].read())
    return result["content"][0]["text"]


def _build_review_prompt(item, accounts) -> str:
    account_list = "\n".join(
        f'- ID {a["id"]}: {a["company_name"]} (aliases: {", ".join(a["aliases"])}, '
        f'domains: {", ".join(a["domains"])})'
        for a in accounts
    )
    content_summary = json.dumps(item.raw_content, default=str)[:2000]
    return f"""You are a customer success data classifier. Determine which customer account
this external content belongs to, based on the content and the known account list.

CONTENT SOURCE: {item.source}
CONTENT TYPE: {item.content_type}
CONTENT URL: {item.source_url}
CONTENT SUMMARY:
{content_summary}

KNOWN ACCOUNTS:
{account_list}

Respond with ONLY a JSON object in this exact format:
{{
  "account_id": <integer or null>,
  "confidence": <float 0.0-1.0>,
  "reasoning": "<one sentence explaining the match or why no match was found>"
}}

Rules:
- Set account_id to null if no account matches confidently.
- confidence >= 0.90 means a deterministic match (name/domain exact or near-exact).
- confidence 0.50-0.89 means a plausible but ambiguous match.
- confidence < 0.50 means no reliable match.
- Never guess. If uncertain, lower the confidence score."""


@shared_task(name="sync_review.tasks.run_agent_review")
def run_agent_review():
    """Process all pending_agent SyncReviewItems via Claude on Bedrock."""
    from accounts.models import Account, AccountFeedConfig
    from .models import SyncReviewItem
    from .views import _write_local_record

    items = list(SyncReviewItem.objects.filter(status="pending_agent").select_related("suggested_account"))
    if not items:
        return {"processed": 0}

    accounts = []
    for acc in Account.objects.prefetch_related("feed_config").all():
        try:
            feed = acc.feed_config
            aliases = list(feed.name_aliases)
            domains = list(feed.email_domains)
        except Exception:
            aliases = []
            domains = []
        accounts.append({
            "id": acc.pk,
            "company_name": acc.company_name,
            "aliases": aliases,
            "domains": domains,
        })

    from django.contrib.auth import get_user_model
    User = get_user_model()
    system_user = User.objects.filter(is_superuser=True).first()

    processed = accepted = pending_human = unassigned = 0
    for item in items:
        try:
            prompt = _build_review_prompt(item, accounts)
            raw = _call_claude(prompt)
            data = json.loads(raw)

            account_id = data.get("account_id")
            confidence = float(data.get("confidence", 0))
            reasoning = data.get("reasoning", "")

            item.confidence_score = confidence
            item.claude_analysis = reasoning

            if account_id and confidence >= HIGH_CONFIDENCE:
                from accounts.models import Account as Acc
                try:
                    account = Acc.objects.get(pk=account_id)
                    item.status = "accepted"
                    item.suggested_account = account
                    if system_user:
                        _write_local_record(item, account, system_user)
                    accepted += 1
                except Acc.DoesNotExist:
                    item.status = "unassigned"
                    unassigned += 1
            elif account_id and confidence >= LOW_CONFIDENCE:
                from accounts.models import Account as Acc
                try:
                    item.suggested_account = Acc.objects.get(pk=account_id)
                except Acc.DoesNotExist:
                    pass
                item.status = "pending_human"
                pending_human += 1
            else:
                item.status = "unassigned"
                unassigned += 1

            item.save(update_fields=[
                "status", "suggested_account", "confidence_score", "claude_analysis", "updated_at"
            ])
            processed += 1

        except Exception:
            logger.exception("Agent review failed for SyncReviewItem %s", item.pk)

    logger.info(
        "run_agent_review: processed=%d accepted=%d pending_human=%d unassigned=%d",
        processed, accepted, pending_human, unassigned,
    )
    return {"processed": processed, "accepted": accepted, "pending_human": pending_human, "unassigned": unassigned}


@shared_task(name="sync_review.tasks.run_mismatch_analysis")
def run_mismatch_analysis(delete_request_id: int):
    """
    After an account_owner approves a delete request, ask Claude why the item
    was incorrectly matched and suggest rule improvements.
    """
    from .models import SyncDeleteRequest

    try:
        delete_req = SyncDeleteRequest.objects.select_related(
            "review_item", "account"
        ).get(pk=delete_request_id)
    except SyncDeleteRequest.DoesNotExist:
        logger.warning("run_mismatch_analysis: delete_request %s not found", delete_request_id)
        return

    item = delete_req.review_item
    account = delete_req.account

    try:
        feed = account.feed_config
        aliases = list(feed.name_aliases)
        domains = list(feed.email_domains)
    except Exception:
        aliases = []
        domains = []

    content_summary = json.dumps(item.raw_content, default=str)[:1500]
    prompt = f"""A sync review item was incorrectly linked to an account and has been removed.
Analyse why the mismatch occurred and suggest concrete rule changes to prevent it recurring.

ACCOUNT: {account.company_name}
ACCOUNT ALIASES: {aliases}
ACCOUNT EMAIL DOMAINS: {domains}
ORIGINAL CONFIDENCE SCORE: {item.confidence_score}
ORIGINAL REASONING: {item.claude_analysis}
REMOVAL REASON: {delete_req.reason}
CONTENT SOURCE: {item.source}
CONTENT SUMMARY:
{content_summary}

Respond with a concise paragraph (3-5 sentences) explaining:
1. Why the item was incorrectly matched.
2. Which alias or domain rule should be added, removed, or narrowed.
3. Any exclusion keyword that would prevent this match in future."""

    try:
        analysis = _call_claude(prompt)
        delete_req.claude_mismatch_analysis = analysis
        delete_req.save(update_fields=["claude_mismatch_analysis"])
        logger.info("Mismatch analysis complete for delete_request %s", delete_request_id)
    except Exception:
        logger.exception("run_mismatch_analysis failed for delete_request %s", delete_request_id)
