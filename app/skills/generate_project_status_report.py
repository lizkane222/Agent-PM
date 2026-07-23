"""
Skill: generate_project_status_report

Uses Claude to write a polished, customer-ready project status report for
a named account, based on the goal sections, action items, meetings, and
resources that have been assembled by the user in the Account Detail page.

Input
-----
account_name   : str    — Company name (used as report title)
report_date    : str    — ISO date string (e.g. "2026-06-11")
goals          : list   — List of goal section objects:
  {
    "name": str,
    "meetings": [{ "name", "date", "duration", "expected_topics", "gong_notes" }],
    "action_items": [{ "task", "status", "priority", "due_date", "assignee_name" }],
    "resources": [{ "label", "url" }]
  }

Output
------
{
  "report": str     — Full markdown-formatted customer status report
  "error": str      — Present only on failure
}
"""

import logging
import os

import anthropic
import httpx

logger = logging.getLogger(__name__)

# Honour any corporate CA bundle configured in the environment; fall back to
# default certificate verification if neither variable is set.
_CA_BUNDLE = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("AWS_CA_BUNDLE") or True

# Cross-region inference profile on AWS Bedrock.
_MODEL = "us.anthropic.claude-sonnet-4-6"

_SYSTEM_PROMPT = """\
You are a senior customer success manager at Twilio writing a project status
report that will be shared directly with the customer.

Guidelines:
- Professional, clear, and concise tone — readable by both executives and ICs.
- Use the exact data provided; do not invent facts.
- Structure with clean markdown (##, ###, bullet lists, bold labels).
- For each goal section: summarise progress, call out completed items with ✅
  and open/overdue items clearly, list all meetings with dates, and include
  any linked resources with their URLs.
- Close with a brief "Next Steps" section aggregating the highest-priority
  open action items across all goals.
- Include the report date prominently at the top.
- The report should feel ready to paste into an email or Google Doc.
"""


def _sanitize(value: str, max_len: int = 500) -> str:
    """Truncate and strip null bytes from user-supplied strings."""
    return str(value)[:max_len].replace("\x00", "")


def _build_user_prompt(account_name: str, report_date: str, goals: list) -> str:
    """Build the Claude prompt, wrapping all user data in XML delimiters."""
    lines = [
        f"<account_name>{_sanitize(account_name, 200)}</account_name>",
        f"<report_date>{_sanitize(report_date, 20)}</report_date>",
        "",
        "<goals>",
    ]

    for goal in goals:
        lines.append("  <goal>")
        lines.append(f"    <name>{_sanitize(goal.get('name', 'Unnamed'), 200)}</name>")

        meetings = goal.get("meetings", [])
        if meetings:
            lines.append("    <meetings>")
            for m in meetings:
                date_str = m.get("date", "")[:10] if m.get("date") else "No date"
                dur = m.get("duration", 0)
                dur_str = f"{round(dur / 60)} min" if dur else ""
                lines.append("      <meeting>")
                lines.append(f"        <name>{_sanitize(m.get('name') or 'Meeting', 200)}</name>")
                lines.append(f"        <date>{_sanitize(date_str, 20)}</date>")
                if dur_str:
                    lines.append(f"        <duration>{dur_str}</duration>")
                if m.get("expected_topics"):
                    lines.append(f"        <topics>{_sanitize(m['expected_topics'], 300)}</topics>")
                if m.get("gong_notes"):
                    lines.append(f"        <notes>{_sanitize(m['gong_notes'], 400)}</notes>")
                lines.append("      </meeting>")
            lines.append("    </meetings>")

        action_items = goal.get("action_items", [])
        if action_items:
            lines.append("    <action_items>")
            for item in action_items:
                due = item.get("due_date", "")[:10] if item.get("due_date") else "No due date"
                lines.append("      <action_item>")
                lines.append(f"        <task>{_sanitize(item.get('task') or 'Action item', 300)}</task>")
                lines.append(f"        <status>{_sanitize(item.get('status', 'Open'), 50)}</status>")
                lines.append(f"        <due>{_sanitize(due, 20)}</due>")
                lines.append(f"        <priority>{_sanitize(item.get('priority', ''), 50)}</priority>")
                if item.get("assignee_name"):
                    lines.append(f"        <assignee>{_sanitize(item['assignee_name'], 100)}</assignee>")
                lines.append("      </action_item>")
            lines.append("    </action_items>")

        resources = goal.get("resources", [])
        if resources:
            lines.append("    <resources>")
            for r in resources:
                lines.append("      <resource>")
                lines.append(f"        <label>{_sanitize(r.get('label', 'Resource'), 200)}</label>")
                if r.get("url"):
                    lines.append(f"        <url>{_sanitize(r['url'], 500)}</url>")
                lines.append("      </resource>")
            lines.append("    </resources>")

        lines.append("  </goal>")

    lines.append("</goals>")
    return "\n".join(lines)


async def generate_project_status_report(
    account_name: str,
    report_date: str,
    goals: list,
    **kwargs,
) -> dict:
    """Generate a customer-ready project status report using Claude."""

    if not account_name or not account_name.strip():
        return {"error": "account_name is required."}
    if not goals:
        return {"error": "No goal sections provided. Add goals before generating a report."}

    user_prompt = _build_user_prompt(account_name, report_date, goals)

    try:
        async with anthropic.AsyncAnthropicBedrock(
            http_client=httpx.AsyncClient(verify=_CA_BUNDLE)
        ) as client:
            response = await client.messages.create(
                model=_MODEL,
                max_tokens=4096,
                system=_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_prompt}],
            )
        report_text = response.content[0].text.strip()
        logger.info(
            "generate_project_status_report: account=%s goals=%d",
            account_name,
            len(goals),
        )
        return {"report": report_text}
    except Exception as exc:
        logger.exception("generate_project_status_report failed: %s", exc)
        return {"error": str(exc)}
