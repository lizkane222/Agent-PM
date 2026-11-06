"""
Fuzzy resolution of spoken account names.

Voice transcription mangles proper nouns ("Archistrator" arrives as "Orchestrator" or
"aOrchestrator"), and exact ``iexact`` lookups then either fail or — worse — quietly
unlink a record. This resolves a spoken name against the real list with one rule:
auto-pick only when the answer is clearly the best, otherwise hand back candidates so
the agent can read them to the caller rather than guess.

Pure functions (no ORM) so the policy is unit-testable without a database.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field

# A match at or above this ratio is accepted outright.
STRONG = 0.80
# Below STRONG, a match is still accepted when it clearly beats every other candidate.
WEAK_FLOOR = 0.60
MARGIN = 0.12
# Candidates offered back to the caller when nothing is clear.
MAX_CANDIDATES = 3

# Suffixes spoken or written inconsistently; stripped for comparison only.
_NOISE = re.compile(r"\b(inc|llc|ltd|corp|corporation|co|company|the)\b\.?", re.I)


def _norm(value: str) -> str:
    value = _NOISE.sub(" ", value or "")
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


@dataclass
class Resolution:
    """Outcome of resolving a spoken name. ``match`` is set only when it is safe to use."""

    match: str | None = None
    exact: bool = False
    candidates: list[str] = field(default_factory=list)

    @property
    def ambiguous(self) -> bool:
        return self.match is None and bool(self.candidates)


def _score(query: str, name: str) -> float:
    q, n = _norm(query), _norm(name)
    if not q or not n:
        return 0.0
    if q == n:
        return 1.0
    ratio = difflib.SequenceMatcher(None, q, n).ratio()
    # Whole-word containment ("agent pm" inside "agent pm features") is a strong signal
    # that plain edit distance underrates because the lengths differ.
    q_words, n_words = set(q.split()), set(n.split())
    if q_words and q_words <= n_words:
        ratio = max(ratio, 0.85)
    elif q in n or n in q:
        ratio = max(ratio, 0.75)
    return ratio


def resolve_name(query: str | None, names: list[str]) -> Resolution:
    """Resolve ``query`` against ``names``."""
    query = (query or "").strip()
    pool = [n for n in dict.fromkeys(names) if n]
    if not query or not pool:
        return Resolution()

    for name in pool:
        if name.casefold() == query.casefold():
            return Resolution(match=name, exact=True)

    ranked = sorted(((_score(query, n), n) for n in pool), key=lambda p: (-p[0], p[1]))
    best_score, best = ranked[0]
    runner_up = ranked[1][0] if len(ranked) > 1 else 0.0

    if best_score >= STRONG and best_score - runner_up >= 0.05:
        return Resolution(match=best)
    if best_score >= WEAK_FLOOR and best_score - runner_up >= MARGIN:
        return Resolution(match=best)

    close = [n for s, n in ranked if s >= WEAK_FLOOR][:MAX_CANDIDATES]
    return Resolution(candidates=close)
