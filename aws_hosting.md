# AWS hosting playbook (Elastic Beanstalk + RDS + CodePipeline + SSM)

This is a generalized write-up of the process used to move Segment Archistrator from
Render onto AWS. It's meant to be handed to an agent deploying a **different** app the
same way. Do not copy the specific names/values below verbatim — the first step is
always to read the target app's own code and figure out its real requirements, then
apply this methodology.

## Step 0: audit the target app before touching AWS

Read the target repo before proposing anything. Specifically look for:

- An existing deploy config for whatever host it's currently on (Render's
  `render.yaml`, a `Procfile`, a `Dockerfile`, a `fly.toml`, CI workflow files, etc.).
  These almost always contain the exact build command, start command, and env var
  list you need — don't guess at them.
- The web framework's settings/config for anything that assumes the *old* host's
  behavior. The most common and most dangerous one: a previous host that always
  terminates TLS for you (Render, Heroku, Fly.io all do), reflected in code as
  hard-coded `SECURE_SSL_REDIRECT = True` / `SESSION_COOKIE_SECURE = True` /
  equivalent. AWS does **not** give you HTTPS for free on a load balancer's default
  URL — only once you own a domain and attach an ACM cert. If the target app hasn't
  decided on a domain yet (see Step 2), these need to become env-gated instead of
  hard-coded, or the app will break the moment it's reachable over plain HTTP
  (session cookies silently stop being sent, or the app redirect-loops). This was the
  single most consequential code change in the Segment Archistrator migration.
- Anything that reads a host-specific env var as a fallback (e.g.
  `RENDER_EXTERNAL_HOSTNAME`). Harmless to leave as dead code on AWS, but flag it.
- What actually needs a build step beyond `pip install`/`npm install` — e.g. a
  frontend that needs compiling, `collectstatic`-equivalent static asset prep,
  anything that needs to run once per deploy (migrations, fixture loads, cache
  warming). AWS's Elastic Beanstalk Python/Node/Ruby platforms do **not** run a
  frontend build step for you, and do not run framework migration commands
  automatically.
- The full list of required env vars/secrets (an `.env.example` is usually the
  fastest way to get this), and which of them are genuinely sensitive (API keys,
  encryption keys, DB credentials) vs. plain config (hostnames, feature flags).

## Step 1: clarifying questions to ask the human, up front

Don't guess on these — getting them wrong costs real time/money to unwind:

1. **How should secrets be stored?** Options: AWS Secrets Manager (costs ~$0.40/secret/month,
   has rotation), SSM Parameter Store (free standard tier, no rotation UI), or
   something the team already uses elsewhere. Default to SSM Parameter Store if the
   human has no preference — it's free and sufficient for most small apps.
2. **Is there a custom domain available, or is this launching on the default AWS
   URL for now?** This gates almost everything about TLS:
   - A custom domain costs money to register (roughly $3–15/year depending on TLD,
     via Route 53 or elsewhere) and isn't optional/free — say this plainly before
     assuming the human wants one. Domain registration is also not something to
     register and bill without their explicit go-ahead; treat it like any other
     recurring charge.
   - No HTTPS is possible without a domain (you cannot get a public ACM cert for
     `*.elasticbeanstalk.com` or `*.amazonaws.com` — you don't own that domain).
   - If the answer is "no domain yet," the app needs to be adjusted to tolerate
     plain HTTP (see Step 0's TLS point) and any OAuth-style login provider that
     requires an `https://` redirect URI needs to be deferred, not configured.
3. **Does the app need more than one instance, or is Single-instance EB fine?**
   Single-instance avoids the load balancer's hourly charge and sidesteps any
   "leader-only" complexity for one-off deploy commands (migrations etc. just run
   once, trivially, since there's only one instance). Default to single-instance for
   a small/low-traffic app; revisit if real load appears.
4. **Which repo/org is this ultimately going to live in**, and does the human
   already have the access needed to wire up a GitHub connection there? (See the
   GitHub App gotchas in Step 6 — this is a frequent, non-obvious blocker.)

## Step 2: the database (RDS)

- Engine: plain **PostgreSQL** (or MySQL if that's what the app uses) — not **Aurora**
  unless there's a specific reason to want it. Aurora is a separate, pricier,
  higher-minimum-size product that happens to speak the same wire protocol; it's
  overkill for a small app.
- Creation method: **Standard create** ("full configuration"), not **Easy create**
  ("express configuration") — Easy create hides the fields you need to control
  (public accessibility, VPC/security group, initial DB name).
- **Template**: picking "Production" vs "Dev/Test" only changes *default* values for
  fields further down the form — every field stays editable regardless. But
  "Production" defaults to notably more expensive choices (bigger instance class,
  Provisioned IOPS storage, longer backup retention, Multi-AZ in some flows) that are
  easy to miss overriding. Prefer **Dev/Test** for a small app to get cheap defaults
  out of the box, and explicitly verify the fields below either way.
- **Availability**: Single-AZ (1 instance), not Multi-AZ, unless the app genuinely
  needs failover — Multi-AZ roughly doubles/triples the instance cost.
- **Instance class**: Burstable classes, `db.t4g.micro` or `db.t3.micro`. This is the
  single biggest lever on the cost estimate — a Production-template default
  (something like `db.m5.large`) can turn a ~$15/month database into a ~$140+/month
  one. Always double check the instance class explicitly.
- **Storage type**: General Purpose SSD (gp3), not Provisioned IOPS — the other
  common source of a cost blowup.
- **Allocated storage**: the engine's minimum (20 GiB for Postgres) is almost always
  enough to start. Leave storage autoscaling on with a modest cap as a safety net.
- **Public access**: No. Lock it down to a specific security group, opened later to
  only the compute tier (Step 4) — never to the whole internet.
- **Credentials**: self-managed (you set a password, you store it), not "Managed in
  Secrets Manager," if the human already chose SSM Parameter Store in Step 1 — no
  reason to pay for Secrets Manager just for this one credential when the app itself
  needs several other secrets stored the same way regardless.
- **Initial database name**: match whatever the app's local `DATABASE_URL` already
  expects, so you don't have to create it by hand afterward.
- Skip Enhanced Monitoring, RDS Proxy, and custom KMS keys for a small app — all add
  cost/complexity with no benefit at this scale.

## Step 3: secrets in SSM Parameter Store

- Convention: `/<app-name>/<env>/<SECRET_NAME>`, e.g. `/my-app/prod/SECRET_KEY`.
- Type: **SecureString** for every single one — plain `String` won't decrypt
  correctly when fetched with `--with-decryption` later.
- Only put genuinely sensitive values here (app secret key, DB connection string
  with embedded password, encryption keys, third-party API tokens/client secrets).
  Non-secret config (hostnames, feature flags, non-sensitive IDs) should be plain
  Elastic Beanstalk environment properties instead — don't SSM-ify everything
  indiscriminately.
- Watch for special characters in a generated DB connection string password (`:  /
  @ ? #`) — these collide with the URL syntax of a `postgres://user:pass@host/db`
  style string and need percent-encoding, or the app's DB URL parser will misparse
  the string.
- If the app has genuinely optional integrations (a feedback form backed by a
  third-party API, an analytics catalog sync, etc.), it's fine to skip creating those
  secrets at first pass — most apps built with this pattern already treat "secret
  unset" as "feature quietly disabled," not an error. Confirm that's actually true in
  the target app's code before assuming it, though.

## Step 4: Elastic Beanstalk application + environment

- Platform/version: match whatever the app pins locally (check for a
  `.python-version`/`.nvmrc`/equivalent) — don't default to "whatever's newest."
- Start with **Sample application** as the code source — don't try to hand it real
  code before the pipeline (Step 6) exists.
- Environment type: Single instance (see Step 1, question 3) unless there's a reason
  not to.
- A **`Procfile`** at the repo root is required for Python/Ruby-style platforms —
  Elastic Beanstalk doesn't autodetect how to start a Django/Rails/etc. app the way
  it autodetects Node. Example: `web: gunicorn <wsgi-module>:application --bind
  0.0.0.0:8000`.
- Health check path: set explicitly to whatever the app's real health endpoint is —
  the default `/` is wrong for many apps and causes false "unhealthy" states even
  when the app is fine.
- Network: same VPC as the RDS instance from Step 2; a public subnet (the instance
  needs outbound internet access for its own dependency install step during
  deploys).
- Non-secret environment properties go here directly (Configuration → Software):
  the app's settings-module selector, `ALLOWED_HOSTS` (set this *after* the
  environment exists and you know its URL), and — if Step 1 said "no domain yet" —
  whatever env var Step 0's TLS fix introduced (e.g. `SECURE_SSL_REDIRECT=False`),
  explicitly flagged as temporary.

## Step 5: wiring compute to database, and permissions

- **Security group**: the EB instance needs an inbound allowance on the database's
  security group for its DB port. Many AWS accounts now have RDS's own guided
  **"Set up EC2 connection"** wizard (Databases → select DB → there's a prompt/button
  for this) that automates exactly this — pick the EC2 instance belonging to the new
  EB environment and let it configure the rule, rather than hand-editing security
  groups unless that wizard isn't available.
- **IAM**: the EB EC2 instance role (AWS creates `aws-elasticbeanstalk-ec2-role`
  automatically) needs an inline policy granting `ssm:GetParameter` scoped to
  `arn:aws:ssm:*:*:parameter/<app-name>/<env>/*`, plus `kms:Decrypt` on
  `arn:aws:kms:*:*:alias/aws/ssm` (assuming the default SSM-managed key, which is the
  default and is free) — without this, the predeploy secrets hook (Step 7) will
  silently fetch nothing.

## Step 6: CodePipeline

- **Build custom pipeline**, execution mode **Superseded** (the standard choice
  unless there's a specific reason for Queued/Parallel).
- **Source**: GitHub (via GitHub App). This has several non-obvious gotchas, learned
  the hard way:
  - **Private repos work completely fine** — this source type authenticates as an
    installed GitHub App, not via public visibility. Don't make a repo public to fix
    a connection problem; that's not the actual issue.
  - A GitHub App can be **installed multiple times** — once under a personal
    account, once under an org, etc. A connection tied to the wrong installation ID
    will fail to see a repo that very much exists and that you can see fine via your
    own git/SSH credentials. If a repo you just typed in doesn't show up as an
    autocompleted suggestion (you have to use a "Use entered value" fallback
    instead), that's a strong signal the connection's installation can't actually
    see it — don't ignore that signal.
  - **Connection name has a 32-character limit.** Don't name it after the full
    `org/repo` path if that's longer than 32 chars — it's just a label, give it
    anything short.
  - **"You don't have permission to create the connection... an owner... must give
    the app read-only access to members of the organization."** — this means exactly
    what it says: this is now a GitHub org-permissions problem, not an AWS problem.
    Only an actual owner of that GitHub org can either (a) create the connection
    themselves, or (b) go into the org's installed-GitHub-Apps settings and grant
    members read access to that installation. There is no AWS-side workaround; find
    that person.
  - **"No Branch [X] found for FullRepositoryName [...]" even though the branch
    verifiably exists** (confirm with `git ls-remote --heads <remote>`) — usually
    means the connection cached "this repo has no branches" from a moment when the
    repo was empty (e.g., you picked it in the wizard before the first push landed).
    Fix: edit the pipeline's Source action, open the branch dropdown, and explicitly
    re-select the branch (even if the text already shows the right name) to force a
    fresh lookup, rather than just retrying the same execution.
- **Build**: AWS CodeBuild, with a `buildspec.yml` at the repo root that mirrors
  whatever the old host's build command did — install deps, build the frontend if
  there is one, run the framework's static-asset-collection step, and (optional but
  good practice) run the frontend test suite here so a red suite blocks the deploy.
  Match the Node/Python/etc. runtime versions to what's pinned locally.
- **Test stage**: skip it unless there's an actual existing CI test stage to reuse.
- **Deploy**: AWS Elastic Beanstalk, targeting the application/environment from Step
  4, with the **Build** stage's artifact as input — not Source's artifact, since
  Source alone doesn't have the compiled frontend/installed deps.

## Step 7: one-off deploy commands (migrations, seed data, etc.) — ordering matters

This is the subtlest part and the one most likely to get built wrong on a first
pass. Elastic Beanstalk (Amazon Linux 2023 platforms) runs deploy hooks in this
order:

1. `.platform/hooks/prebuild`
2. `.ebextensions` `commands`/`container_commands` (and option_settings)
3. `.platform/hooks/predeploy`
4. — app is deployed/restarted —
5. `.platform/hooks/postdeploy`

**Consequence**: if secrets (DB connection string, app secret key) are fetched from
SSM in a `predeploy` hook (step 3), anything that needs those secrets — migrations,
fixture loads, cache warms — must run in `postdeploy` (step 5), **not** in
`.ebextensions` `container_commands` (step 2), because step 2 runs *before* the
secrets exist. Getting this backwards means migrations silently run without a real
`DATABASE_URL` and either crash or (worse) connect to nothing meaningful.

- `predeploy` script: calls `aws ssm get-parameter --with-decryption` for each secret
  name under the app's parameter path, and appends `export NAME="value"` lines to
  `/opt/elasticbeanstalk/deployment/env` (the file EB sources before starting the
  app). **Escape the value** before interpolating it into that line — a secret
  containing a `"`, `` ` ``, `$`, or `\` would otherwise either break the file for
  every later `source` of it, or get executed as a shell command. Skip (don't fail
  the deploy) if a given parameter doesn't exist, for secrets that are genuinely
  optional.
- `postdeploy` script: sources that same env file, activates the app's venv
  (`/var/app/venv/*/bin/activate` on AL2023 Python platforms), `cd`s to
  `/var/app/current`, and runs whatever one-off commands the app needs (migrations,
  seed data, catalog syncs, etc.). Note in a comment if this assumes single-instance
  (no leader election) — if the app ever moves to a multi-instance environment,
  these need a leader check or they'll race across instances.
- `.ebextensions` is still the right place for things that are genuinely just
  config/option_settings with no dependency on secrets — e.g. the health check path.

## Step 8: verification checklist

- Pipeline: Source → Build → Deploy all green.
- Elastic Beanstalk environment: Green health.
- EB logs (Request logs) show the predeploy and postdeploy hook scripts running
  without error — this is the first real test of secrets-fetch + migrations against
  the actual database, not just configuration that looks right on paper.
- Visit the app's URL: confirm it's the real app, not the "Sample application" page.
- Hit the health check endpoint directly.
- **Sign in / session persistence test, specifically if launching HTTP-only**: this
  is the concrete way to verify the Step 0 TLS fix actually works — confirm a session
  survives a page reload over plain `http://`. This is the single most likely thing
  to look fine in every config screen and still be silently broken in practice.
- Run the app's own automated test suite (`pytest`, `npm test`, etc.) locally against
  prod-like settings (`DJANGO_SETTINGS_MODULE=<prod>` or equivalent, with
  `SECURE_SSL_REDIRECT`-equivalent turned off if no domain yet) as an extra check
  before/alongside the first real pipeline run — faster feedback loop than waiting on
  a full pipeline execution each time.

## Deferred / explicitly out of scope until a domain exists

If Step 1 established there's no custom domain yet:

- No ACM cert, no HTTPS listener, no Load-balanced environment type needed yet.
- Any OAuth-style login provider requiring an `https://` redirect URI stays
  unconfigured — most apps built against this pattern treat "unset" as "that login
  method just doesn't appear," not an error, but **confirm that's true in the target
  app's code** rather than assuming it.
- `ALLOWED_HOSTS` and any CSRF-trusted-origins config only need the default EB URL,
  not a future domain.
- Revisit all of the above together once a domain is actually registered — don't try
  to half-configure HTTPS pieces before the domain exists.

## A general habit worth keeping: re-check security advisories against actual dependencies, not assumptions

When a security concern comes up that's framed in terms of "my colleague's app had
this" or "I read about this CVE," the right response is to check the *target* app's
actual dependency tree and code (installed package versions, what libraries are
imported, whether untrusted input ever flows through the component in question) —
not to assume shared infrastructure implies shared exposure, and not to assume
exposure just because a library name matches. Most CVEs require a specific usage
pattern (e.g. "decompresses attacker-controlled data") that a given app may not
actually exercise at all.
