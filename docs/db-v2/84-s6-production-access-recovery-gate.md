# S-6 Production-Access / Recovery Gate

**Gate type:** bounded access-and-recovery investigation. Not production execution.
No engine, calculator, migration, registry, or seed change. No production
`module_reading` write. No secret printed, logged, committed, or reproduced. The
deliverable is this document and a single classification.

**Predecessor:** Gate 83 (`29c992b`) — production reading authorization NOT APPROVED
because the production PostgreSQL database could not be inspected.

---

## 1. Objective

Determine, without changing the approved architecture, whether this environment has
a legitimate mechanism to reach the **V2 production PostgreSQL database** for a
read-only inspection, and if not, state the exact operator prerequisite. Production
writing stays CLOSED regardless of outcome.

---

## 2. The required V2 production connection (from source)

The V2 pipeline connects via **direct/session-mode PostgreSQL** (`pg`), configured
by `src/v2/config/index.ts::loadV2Config` and documented in `src/v2/README.md`.
The variables:

| Variable | Required | Default | Note (from source) |
|---|---|---|---|
| `PT_V2_DB_HOST` | **yes** | — | Supabase: `db.<ref>.supabase.co` (direct, IPv6) or `aws-0-<region>.pooler.supabase.com` (session pooler, IPv4). |
| `PT_V2_DB_NAME` | **yes** | — | `postgres` on Supabase. |
| `PT_V2_DB_PASSWORD` | **yes at use** | — | The ordinary **database password for the `postgres` role** (quoted). `requireCredential()` hard-fails without it. |
| `PT_V2_DB_PORT` | no | `5432` | Session mode. `6543` (transaction pooler) is refused (R-58). |
| `PT_V2_DB_USER` | no | `postgres` | Base login. |
| `PT_V2_DB_USER_SUFFIX` | pooler only | — | Supavisor tenant `<project-ref>`; empty for the direct host. |
| `PT_V2_DB_SSL` / `_REJECT_UNAUTHORIZED` | no | `true` / `true` | Keep on. |
| `PT_V2_DB_SSL_CA` | managed hosts | — | Path to the Supabase project CA PEM. |

**Connection path confirmed:** direct PostgreSQL, session mode, TLS. It is **not**
the Supabase REST API and cannot be satisfied by a REST URL or a service/JWT key.

**Documented secure supply mechanism:** `config/env.ts` reads `.env` into
`process.env` at the three V2 entry points; **the real environment outranks the
file** (so a CI secret or container definition wins); a missing `.env` is not an
error; copy from `.env.v2.example`. `npm run doctor:v2` diagnoses the path from
`.env` to the startup packet **without printing any secret** (it reports byte
length, an 8-char SHA-256 fingerprint, and whether file and process hold the same
value). This is the sanctioned, existing mechanism — nothing new is needed.

---

## 3. Availability in the current environment

| Check | Result |
|---|---|
| `PT_V2_DB_HOST` / `PT_V2_DB_NAME` for production | **absent** — the only configured values point to the local scratch cluster (`127.0.0.1` / `ptv2`) via a scratchpad helper, not committed and not production. |
| `PT_V2_DB_PASSWORD` in the real environment | **NOT SET.** |
| What `.env2` actually contains | `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` only (plus provider sports keys). Both are **REST** credentials. |
| Is the service key usable as the DB password? | **No.** `SUPABASE_SERVICE_KEY` is a REST/JWT key, not the `postgres` role password. Using it as `PT_V2_DB_PASSWORD` would be a REST-to-Postgres substitution — forbidden by this gate. |
| Can the host be derived from `SUPABASE_URL`? | The project ref is derivable, but the **password is not**, and deriving a host to attempt a guessed credential is forbidden. |
| MCP connectors | **none installed** (`ListConnectors` returned empty). |
| MCP servers present | `github`, `Claude_Code_Remote` — neither is a Postgres/Supabase data path. |
| Network egress to Supabase Postgres (5432) | **denied** all session (agent proxy 403 on CONNECT to the Supabase host; the HTTPS proxy carries tool traffic, not a raw Postgres session). |
| Only reachable database | the local scratch `ptv2` cluster — a verification proxy, explicitly **not** production. |

**Two independent blockers, either sufficient:** (a) no production Postgres
credential is present (`PT_V2_DB_PASSWORD` absent; only a REST key exists), and (b)
egress to the Supabase Postgres host is blocked. Even a fully-credentialed
connection could not open from here.

---

## 4. Workarounds explicitly NOT taken

Per objective #5, none of the following was attempted: credential guessing;
using `SUPABASE_SERVICE_KEY` as the DB password; deriving the host from
`SUPABASE_URL` to attempt a connection; substituting the Supabase REST API for the
direct PostgreSQL path; any proxy bypass or TLS-verification disablement. No secret
was printed, logged, or committed.

---

## 5. The read-only inspection this gate would run once access exists

Deferred until a legitimate connection is available; to be executed with a
read-only session (no writes), establishing at minimum:

1. migration state through **024** applied to production;
2. the two target `module_version` rows exist and carry the migration-024 rationale
   text (`home_away_split` 1.0.0, `readiness_tracker` 1.0.0);
3. production `module_reading` count (expected 0);
4. production `module_evidence` count (expected 0);
5. production `module_evidence_item` count (expected 0);
6. prerequisite feature values present:
   - `team.home_win_rate` + `team.away_win_rate` (COMPETITION_SCOPED) for eligible
     team × edition × as_of;
   - `team.momentum` (ALL_COMPETITIONS) for eligible team × as_of;
7. whether any production readings already exist (there must be none).

`doctor:v2` is the first step (it verifies the credential path safely); the
inspection queries are all `SELECT`-only.

---

## 6. Exact operator prerequisite

To lift the blocker, the operator must provide, **in the real environment or a
secure uncommitted `.env` of the environment that will run the inspection** (never
committed to the repository):

1. `PT_V2_DB_HOST` — the Supabase host (`db.<project-ref>.supabase.co` for the
   direct IPv6 connection, or `aws-0-<region>.pooler.supabase.com` for the session
   pooler).
2. `PT_V2_DB_NAME` — `postgres`.
3. `PT_V2_DB_PASSWORD` — the **database password of the `postgres` role** (quoted;
   not the service/JWT key).
4. `PT_V2_DB_USER_SUFFIX` — the `<project-ref>` **only if** using the session
   pooler (omit for the direct host).
5. `PT_V2_DB_SSL_CA` — path to the Supabase project CA PEM (managed host).
6. **Network egress** from the running environment to the Supabase Postgres host on
   port **5432** (session mode).

(Port stays `5432`; `PT_V2_DB_USER` may stay `postgres`.) With these present,
`npm run doctor:v2` should report `file == process` and a successful session before
the read-only inspection of §5 is run.

A separate note, unchanged from prior gates and not actioned here: the secrets in
`.env2` (service key, provider keys) remain in git history and warrant rotation —
that is an operator security task, independent of this gate.

---

## 7. Classification

### B. PRODUCTION ACCESS UNAVAILABLE — OPERATOR ACTION REQUIRED

The V2 production PostgreSQL database cannot be reached from this environment: no
`PT_V2_DB_PASSWORD` (or any `PT_V2_DB_*` production value) is present — only a
Supabase REST URL and service key — and egress to the Supabase Postgres host is
denied. No connector or tooling provides a legitimate alternative. The read-only
inspection (§5) therefore could not be performed, and production-write
authorization remains **CLOSED**.

---

## 8. Status and next gate

- **Production access:** UNAVAILABLE — operator action required (§6).
- **Read-only inspection:** NOT PERFORMED (no legitimate connection).
- **Production write authorization:** remains CLOSED (Gate 83 NOT APPROVED stands).
- **Implementation state:** `home_away_split` and `readiness_tracker` remain
  implemented and verified on the scratch proxy; unchanged by this gate.
- **Module #3:** out of scope; not selected.
- **No code, schema, migration, seed, or registry change** was made; no secret was
  exposed; no workaround was attempted.

**Next gate:** once the operator supplies the §6 prerequisites in a reachable
environment, re-run this access gate to complete the §5 read-only inspection. On a
clean result (migrations ≤ 024 applied, both rationales correct, 0 existing
readings/evidence/items, prerequisite feature values present), proceed to the
**production-write authorization gate** (a re-run of Gate 83's decision against
verified production state), then a small, auditable first write. **No Module #3
until production authorization is granted.**
