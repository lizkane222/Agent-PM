"""
"Claude recommended tools": read a skill's description and pick the capabilities it needs.

Claude only ever *suggests*. Every name is checked against the live skill-safe registry
before it reaches the user, so an invented or forbidden tool (a delete, an SMS) can't be
offered, and the author still chooses what to keep.
"""

from __future__ import annotations

import textwrap

from agents.mcp_server import mcp_server

from .claude_json import loads_object

MAX_RECOMMENDED = 15

_SYSTEM = textwrap.dedent("""\
    You choose which platform capabilities an Agent PM skill needs.

    You are given the skill author's description (and possibly draft instructions) and the
    COMPLETE list of capabilities a skill is allowed to use, each with a one-line description.

    Choose the SMALLEST set that lets the skill do what the description asks. Prefer read tools
    over write tools unless the description clearly says to create or change something. Do not
    add a tool "just in case". Always include a search or lookup tool when the skill must find
    records by name.

    If the description needs something that is NOT in the list (for example sending a text or
    email, deleting records, or calling a phone number), do not invent a tool: describe the gap
    in "limitations" in plain language.

    Reply with JSON only, no prose and no code fence:
    {"tools": [{"name": "<exact tool name>", "reason": "<=14 words, why it is needed"}],
     "limitations": ["<plain-language gap>", ...]}
""")


def catalog_lines() -> list[tuple[str, str]]:
    return [(n, mcp_server._description(n)) for n in mcp_server.skill_safe_tools()]


def recommend_tools(description: str, instructions: str = "", *, client, model: str) -> dict:
    catalog = catalog_lines()
    allowed = {n for n, _ in catalog}
    prompt = (
        "CAPABILITIES YOU MAY CHOOSE FROM:\n"
        + "\n".join(f"- {n}: {d}" for n, d in catalog)
        + f"\n\nSKILL DESCRIPTION:\n{description.strip()}"
        + (f"\n\nDRAFT INSTRUCTIONS:\n{instructions.strip()[:6000]}" if instructions.strip() else "")
    )
    resp = client.messages.create(
        model=model, max_tokens=1500, system=_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    data = loads_object(resp.content[0].text)

    picked, seen = [], set()
    for item in data.get("tools") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if name in allowed and name not in seen:
            seen.add(name)
            picked.append({"name": name, "reason": str(item.get("reason") or "")[:140]})
        if len(picked) >= MAX_RECOMMENDED:
            break
    limits = [str(x)[:200] for x in (data.get("limitations") or []) if isinstance(x, str)][:5]
    return {"tools": picked, "limitations": limits}
