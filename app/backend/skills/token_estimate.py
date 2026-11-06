"""
Estimate what one run of a skill costs in tokens.

Two halves, kept separate on purpose:

* **Measured facts** (code): the agent's fixed per-round input (system prompt + all tool
  schemas — resent on every model call), the size of the skill's instructions, templates and
  attached documents.
* **Judgement** (Claude): how many model rounds this kind of task takes, how large its tool
  results are, how much it writes.

The totals are then computed here from Claude's numbers, so the arithmetic can't be wrong and
the same inputs always give the same answer. It is an estimate: prompt caching (which makes
repeated input cheaper) and the user's own request length are not modelled.
"""

from __future__ import annotations

import json
import textwrap
from datetime import timedelta

from django.utils import timezone

from agents.mcp_server import mcp_server

from .claude_json import loads_object

CHARS_PER_TOKEN = 4          # the usual rough rule; documented rather than hidden
MAX_ROUNDS = 10              # AgentOrchestrator._agentic_loop MAX_ITERATIONS
MAX_TOOL_RESULT_TOKENS = 20_000
MAX_OUTPUT_TOKENS = 4_000
ATTACHMENT_CHAR_CAP = 40_000  # run_assembly.MAX_TOTAL_ATTACHMENT_CHARS

_SYSTEM = textwrap.dedent("""\
    You estimate how many tokens ONE run of an Agent PM skill will use. Agent PM's assistant
    works in rounds: each round is one model call; a round may request tool calls, whose results
    are appended and sent back in the next round. The final round writes the answer.

    You are given measured facts about the skill. Judge only these things, as whole numbers:
    - rounds_expected: model calls for a typical run (1 = answers without tools)
    - rounds_low / rounds_high: a light run and a heavy run (a busy account, many records)
    - tool_result_tokens_per_round: average size of the tool results returned each tool round
    - output_tokens_per_round: average tokens the model writes per round (final answer is longer)

    Be realistic, not cautious: a skill that looks up one list and summarises it is 2-3 rounds.
    A skill that loops over many accounts or records is more. Reply with JSON only:
    {"rounds_expected": n, "rounds_low": n, "rounds_high": n,
     "tool_result_tokens_per_round": n, "output_tokens_per_round": n,
     "rationale": "<=40 words"}
""")


def _tokens(chars: int) -> int:
    return max(0, chars) // CHARS_PER_TOKEN


def base_round_input_tokens() -> int:
    """Fixed input of every model call: the system prompt plus every tool schema."""
    from agents.agent import SYSTEM_PROMPT

    return _tokens(len(SYSTEM_PROMPT) + len(json.dumps(mcp_server.tool_schemas())))


def skill_facts(skill) -> dict:
    attach_chars = sum(len(a.text or "") for a in skill.attachments.all())
    template_chars = sum(len(t.get("body_html", "")) for t in (skill.templates or []))
    prompt_tokens = _tokens(
        len(skill.instructions or "") + len(skill.description or "")
        + min(attach_chars, ATTACHMENT_CHAR_CAP) + template_chars
    )
    return {
        "base_round_input_tokens": base_round_input_tokens(),
        "skill_prompt_tokens": prompt_tokens,
        "instructions_tokens": _tokens(len(skill.instructions or "")),
        "attachment_tokens": _tokens(min(attach_chars, ATTACHMENT_CHAR_CAP)),
        "attachments": skill.attachments.count(),
        "templates": len(skill.templates or []),
        "allowed_tools": list(skill.allowed_tools or []),
        "chained_skills": list(skill.chained_skills or []),
        "needs_accounts": bool((skill.context_defaults or {}).get("needs_accounts")),
    }


def _clamp(value, lo, hi, default):
    try:
        v = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def totals(rounds: int, base: int, prompt: int, tool_result: int, out_per_round: int) -> dict:
    """Input grows each round by the previous round's tool results and output."""
    per_round_fixed = base + prompt
    inp = rounds * per_round_fixed + (tool_result + out_per_round) * (rounds * (rounds - 1) // 2)
    out = rounds * out_per_round
    return {"rounds": rounds, "input": inp, "output": out, "total": inp + out}


def estimate_skill(skill, *, client, model: str) -> dict:
    facts = skill_facts(skill)
    ask = (
        f"Skill name: {skill.name}\nDescription: {skill.description}\n"
        f"Instructions:\n{(skill.instructions or '')[:6000]}\n\n"
        f"Measured facts: {json.dumps({k: v for k, v in facts.items() if k != 'allowed_tools'})}\n"
        f"Capabilities it may use: {', '.join(facts['allowed_tools']) or '(none)'}"
    )
    resp = client.messages.create(
        model=model, max_tokens=500, system=_SYSTEM, messages=[{"role": "user", "content": ask}],
    )
    j = loads_object(resp.content[0].text)

    expected = _clamp(j.get("rounds_expected"), 1, MAX_ROUNDS, 3)
    low = _clamp(j.get("rounds_low"), 1, expected, max(1, expected - 1))
    high = _clamp(j.get("rounds_high"), expected, MAX_ROUNDS, min(MAX_ROUNDS, expected + 2))
    tool_result = _clamp(j.get("tool_result_tokens_per_round"), 0, MAX_TOOL_RESULT_TOKENS, 1500)
    out_pr = _clamp(j.get("output_tokens_per_round"), 1, MAX_OUTPUT_TOKENS, 400)

    base, prompt = facts["base_round_input_tokens"], facts["skill_prompt_tokens"]
    result = {
        "low": totals(low, base, prompt, tool_result, out_pr),
        "expected": totals(expected, base, prompt, tool_result, out_pr),
        "high": totals(high, base, prompt, tool_result, out_pr),
        "params": {"tool_result_tokens_per_round": tool_result, "output_tokens_per_round": out_pr},
        "facts": facts,
        "rationale": str(j.get("rationale") or "")[:300],
        "model": model,
        "assumptions": (f"~{CHARS_PER_TOKEN} characters per token; prompt caching and the length of "
                        "the user's own request are not modelled."),
    }
    skill.token_estimate = result
    skill.token_estimated_at = timezone.now()
    skill.save(update_fields=["token_estimate", "token_estimated_at"])
    return result


def is_stale(skill) -> bool:
    """True when the skill changed after it was estimated (or was never estimated)."""
    if not skill.token_estimated_at:
        return True
    return skill.updated_at > skill.token_estimated_at + timedelta(seconds=2)
