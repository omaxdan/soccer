# S-6 Production Read-Only Verification Gate — Attempt 2

**Gate type:** read-only production verification. No production write, no pipeline
run, no schema/seed/registry/engine/calculator change, no Module #3, no secret
printed. Deliverable: this document and a single classification.

**Predecessors:** Gate 83 (write NOT APPROVED); Gate 84 (access UNAVAILABLE); Gate
85 (read-only verification FAILED — no `PT_V2_DB_*` credentials in this
environment). The operator then populated `.env.v2.example` (commit `f870b21`) with
the production values and reported a successful independent `doctor:v2 --probe`.

---

## 1. Connectivity from this gate's environment

**Progress: the credential/configuration blocker from Gate 85 is resolved.** After
copying the operator's `.env.v2.example` to a git-ignored `beta/backend/.env` (the
path `config/env.ts` loads), `npm run doctor:v2` (secret-safe, no `--probe`) reports
a fully-formed target:

- host: Supabase **shared pooler (Supavisor)** — session mode; port **5432**;
  database **postgres**; SSL **on**, verify certificate **yes**; CA bundle
  `prod-ca-2021.crt` **loaded** (1 certificate).
- login `postgres` + tenant username suffix (Supavisor tenant).
- credential: `PT_V2_DB_PASSWORD` **set**, `file == process` **yes** (quoted).

**New blocker: raw-TCP database egress is not available from this environment.**
`npm run doctor:v2 -- --probe` (the authenticated read-only test) fails at the
**TCP** layer, before authentication:

```
handshake trace
  15013ms  FAILED at tcp: stalled at tcp
  meaning  The TCP connection never completed. Nothing accepted the socket —
           a firewall, a blocked port, or an unreachable address.
probe — one read-only connection
  FAILED   timeout expired
  meaning  NETWORK — nothing answered on that host and port within the timeout.
```

This is a documented limitation of this execution environment, not a defect to
route around. The agent egress proxy README states plainly:

> **Not supported through the proxy (report, do not work around):** … non-443
> HTTPS ports, **raw-TCP databases**. If a tool still cannot work through the
> proxy, report it to your administrator or Anthropic support so the policy or
> tooling can be fixed.

The V2 pipeline requires a **direct/session-mode PostgreSQL** connection on 5432 —
a raw-TCP database connection — which the proxy does not carry. The operator's
successful probe ran in an environment with raw-TCP egress to Supabase (their own
machine/CI); this sandbox has only HTTPS-through-proxy egress. No workaround was
attempted (no proxy bypass, no port change, no REST substitution).

**Authentication was never reached**, so this gate cannot even confirm the
credentials are *valid* against production — only that they are *present and
internally consistent* in this environment.

---

## 2–6. Production inspection (STEPs 1–5) — NOT PERFORMED

Every production check requires an open connection, which the TCP blocker prevents.
All remain **UNVERIFIED against production**:

- migrations through 024; migration 023 columns; migration 024 rationales and their
  exact match; `module_version` count/identities; schema state (STEP 1);
- `module_reading` / `module_evidence` / `module_evidence_item` counts and whether
  any readings exist (STEP 2) — **not assumed zero from scratch**;
- prerequisite feature availability: `team.home_win_rate` / `team.away_win_rate`
  (COMPETITION_SCOPED), `team.momentum` (ALL_COMPETITIONS) (STEP 3);
- production module/version registration and active flags (STEP 4);
- contract comparison for both modules (STEP 5).

---

## 7. SCRATCH VERIFIED vs PRODUCTION VERIFIED

**SCRATCH VERIFIED** (local `ptv2`, migrations 001–024; prior gates + this session,
unchanged): migrations through 024; migration 023 columns present; migration 024
amended both 1.0.0 rationales, byte-identical to the seed (`e8e2464…`, `91d4ee9…`);
`module_version` = 13; `module_reading` / `module_evidence` /
`module_evidence_item` = 0; `MODULE_CALCULATORS` = exactly
`[home_away_split, readiness_tracker]`; only two calculator files; Module #3 absent;
both suites 55/55; full DB suite at the documented 14-failure baseline.

**PRODUCTION VERIFIED:** **nothing at the database level.** The only production-
adjacent fact newly established is that the connection **configuration** now loads
and is well-formed in this environment (host/port/SSL/CA/credential); the database
itself was never reached (TCP blocked), so no production migration, rationale,
count, feature, or registration fact is verified.

Scratch remains a proxy and is not proof of production state.

---

## 8. Discrepancies

1. **Environmental (the blocker):** raw-TCP PostgreSQL egress (port 5432) is not
   available from this gate's environment; the proxy explicitly does not carry
   raw-TCP databases. Credentials are present; the network path is not.
2. **Security — must be actioned by the operator:** the production values were
   supplied by committing them into the **tracked** file `.env.v2.example`
   (`f870b21`), which places live secrets — the database password, the Supabase
   service key, the provider API keys, the host and tenant — into git history. No
   value is reproduced here. This is an exposure independent of this gate:
   - rotate the affected secrets (DB password, Supabase service key, provider keys);
   - remove the real values from the tracked `.env.v2.example` (restore it to a
     placeholder template) and supply secrets only through an untracked `.env` or
     injected environment variables, per `src/v2/README.md`.
   (This gate did not commit any secret; the local `.env` copy is git-ignored and
   was removed after the connection attempt.)

No discrepancy in code, schema, or the modules was found — none could be checked
against production.

---

## 9. Classification

### B. PRODUCTION READ-ONLY VERIFICATION FAILED — REMEDIATION REQUIRED

The credential half is now satisfied, but this gate could not observe production:
raw-TCP database egress on 5432 is unavailable in this environment (a documented
proxy limitation to report, not work around), so authentication was never reached
and no production fact was established. Production write authorization remains
**CLOSED**.

---

## 10. Remediation and next gate

**Remediation:**
1. **Run this gate from an environment with raw-TCP egress to the Supabase
   PostgreSQL host on 5432** — e.g. the operator's own environment (where the probe
   succeeded), a CI runner, or a Claude Code Remote environment whose network
   policy permits raw-TCP databases. The credentials are already correct; only the
   network path is missing here. (If the intent is for this sandbox to reach it,
   the operator/Anthropic must enable raw-TCP database egress for this environment —
   the proxy README says to report it for a policy/tooling fix.)
2. **Rotate and un-track the committed secrets** (§8.2) before further use.

**Next gate:** re-run this **production read-only verification gate** in a
raw-TCP-capable environment. It will `doctor:v2 --probe` to authenticate, then run
SELECT-only queries to establish §§2–6 (migrations ≤ 024, both amended rationales
exact, 0 existing readings/evidence/items, prerequisite feature values present, no
pre-existing readings). On a clean pass it classifies **A** and hands off to the
separate **production-write authorization gate** (Gate 83's decision re-evaluated
against verified production state), then a small, auditable first write.

No code, schema, migration, seed, or registry change was made in this gate. No
production write occurred. Module #3 remains out of scope.
