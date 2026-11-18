# AI data governance

Companion to CLAUDE.md ("MCP server and agent tools", "Outbound communication governance").

## What goes to which model
- One vendor only: Anthropic Claude, through the corporate LiteLLM gateway (`AGENT_GATEWAY_BASE_URL`, https only).
  `core/llm.py` is the single funnel: `model_for_tier()` / `guard_model()` refuse routers (`et-router`,
  `claude-router`), non-Anthropic ids and Opus. `complete(model=...)` and `SUMMARY_MODEL` pass through the same guard.
  `AGENT_REQUIRE_ANTHROPIC_MODEL=0` is an operator-only switch (environment); no request input reaches it.
- Credential: static `ANTHROPIC_API_KEY`, else the operator-configured `AGENT_GATEWAY_TOKEN_COMMAND`
  (run without a shell, fixed argv, 20 s timeout, no user input). Tokens are never put in prompts or results.
- Sent to the model: the user's chat text and history, tool results for records *that user* may see, skill
  instructions/attachments/lookups they run, recap emails and Gmail threads (capped 6-20k chars), sync-review
  content summaries (2k chars), Airtable field-name samples. Voice: transcribed speech, same tools.
- Never sent: OAuth tokens, env values, passwords, API keys (tool results carry record fields only; Console
  redacts any argument named token/secret/password/key/credential).

## Who can see what
- `AgentSession`/messages/tool calls: owner and people the owner shared with (read + continue; only the
  owner can rename or delete). `token-stats` and exports are scoped the same way.
- `SkillRun` / Console: owner only; `?scope=all` is Admin-only. `get_skill_run_data` is owner only.
- Skills: creator, or public+approved. Staff (`is_staff`) can open any skill (known; see residual risks).
- Voice sessions: tied to the verified caller; unverifiable callers are ended.
- Agent tools read through the same scoping as the app (REST bridge, or account membership). Staff get no
  extra reach through the agent (`get_airtable_records` has no staff bypass and excludes private Admin items).

## Prompt injection
- External text (emails, Slack, notes, tickets, attachments, lookups) is fenced as data (`<data>`, `<email>`,
  `<thread>`, `<content>`), fence-closing sequences are neutralised, and the chat and voice system prompts say
  tool results are data. Model output derived from such text is validated (thread status labels, Airtable field
  type, sync-review account must be one offered AND be literally named in the content before auto-filing).
- Whatever injected text persuades the model to call is still bounded by `MCPServer.dispatch`: schema checks,
  per-user scoping, `CONFIRM_REQUIRED` / `VOICE_CONFIRM_TOOLS`, `OUTBOUND_TOOLS`, rate limits, skill scope.

## Logging
- INFO logs carry ids and sizes, not prompts, spoken text, search queries or tool results. Exceptions are
  logged with a ref; users see fixed messages. The Console stores summarised args, never results.

## Retention and deletion
- `python manage.py purge_ai_data --older-than-days N [--user NAME] [--commit]` removes agent sessions
  (messages, tool calls), voice-call transcripts, skill runs (events, staged data) and voice-launch rows.
  Dry run unless `--commit`. `AI_DATA_RETENTION_DAYS` supplies a default age (0 = no policy, off). Schedule it
  from cron/Celery beat if a policy is adopted; nothing runs automatically.
- Skill attachments live with the skill (deleted with it) and, when filed to an account, as artifacts.

## Cost and abuse controls
- Daily token budgets (`agents/token_budget.py`), per-category tool rate limits, `agent_stream` throttle,
  `max_tokens` per tier, 15 MB upload cap, extraction caps (docx expansion 30 MB / 500 members, PDF 200 pages,
  HTML 1 MB, linear-time tag stripping), 20 attachments per skill.

## Adding a tool safely
1. Register with `@mcp_server.tool(group=..., skill_safe=..., schema=...)`; bound every argument.
2. Go through `rest_bridge` for anything the app can already do; scope reads by user unconditionally,
   with no staff bypass and `sync_to_async(thread_sensitive=True)`.
3. Delete or leaves-the-platform tools: add to `CONFIRM_REQUIRED`, `OUTBOUND_TOOLS`, `VOICE_CONFIRM_TOOLS`.
4. Return `ToolPolicyError` for refusals; never exception text or credentials.
5. Test through `mcp_server.dispatch` (happy path, another user's record refused, forbidden args refused),
   and update the Agent Capabilities card plus `EXPECTED_SKILL_SAFE` if relevant.
