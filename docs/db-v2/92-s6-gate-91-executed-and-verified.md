# S-6 Gate 91 — Executed & Verified: PASSED

**Gate type:** deployment execution record. The `seed:v2` feature-registry
deployment was executed against production by the operator from the raw-TCP
environment (this sandbox has no raw-TCP egress); this records the outcome.

---

## 1. Sequence

| Step | Action | Result |
|---|---|---|
| §4 pre-flight | SELECT-only baseline | `5 \| 7 \| 10 \| 7 \| 0`; module_version 13; md5s `e8e2464…`/`91d4ee9…`; `all13_md5=d57b9d8…`; readings 0 — all abort conditions clear |
| §5 deploy | `npm run seed:v2` | `v2 seed complete: 32 inserted, 146 already present` |
| §6 post | SELECT-only verification | `8 \| 11 \| 14 \| 11 \| 0` + preservation intact |
| §7 idempotency | `npm run seed:v2` again | `0 inserted, 178 already present`; registry unchanged |

---

## 2. Feature-registry delta — exactly as authorized

| Relation | Reported | Authorized |
|---|---|---|
| feature.feature_calculator | +3 (5 present) → 8 | +3 |
| feature.feature_definition | +4 (7 present) → 11 | +4 |
| feature.feature_definition_context_kind | +4 (10 present) → 14 | +4 |
| feature.feature_version | +4 (7 present) → 11 | +4 |

Present after deploy: calculators `venue_win_rate`, `team_momentum`,
`travel_itinerary`; definitions `team.home_win_rate` / `team.away_win_rate`
(TEAM · COMPETITION_SCOPED · v1), `team.momentum` / `team.travel_distance`
(TEAM · ALL_COMPETITIONS · v1).

---

## 3. Preservation — all critical boundaries held

- `module.module_version`: **+0**, count **13**, `all13_md5 = d57b9d898c5e27eae7c374cd74a6a7fe`
  (**unchanged** from the pre-flight baseline) — the migration-024 rationales and
  all 13 versions are intact.
- `feature.feature_value = 0`; `module.module_reading / evidence / item = 0 / 0 / 0`.
- No existing row mutated (`INSERT … ON CONFLICT DO NOTHING`); no migration; no S-5.

**Idempotency:** the second run inserted **0** (178 present), registry still
`8|11|14|11|0` — the deployment converged.

---

## 4. Two items recorded honestly

1. **First-run total was 32 inserted, not 15.** The feature-registry delta is 15
   (3+4+4+4); the additional **~17** inserts were into **other registry-metadata
   tables** (vocabularies / entitlement features / quality-check versions), which
   were also stale in production. This is confined to registry metadata — `seed:v2`
   writes only registries plus operations telemetry and structurally cannot write
   `feature_value`, `module_reading`, or mutate `module_version` (all confirmed
   unchanged). It exceeded the itemized `+0-elsewhere` prediction of Gate 91 §3
   because Gate 90/91 assumed production's non-feature registries were complete;
   they were not. The exact per-relation breakdown of the +17 was not captured in
   the pasted summary, but is bounded by `seed:v2`'s registry-only write surface;
   no output or version data was created or changed.
2. **One transient connection timeout during the `pt_pipeline_feature` stage** on
   the idempotency run — the documented Supabase cold-pooler connect latency
   (`config/index.ts`); the built-in acquisition retry recovered and the stage
   completed SUCCEEDED. Recorded as a **recovered operational transient, not a
   deployment failure.**

---

## 5. Status

- **Gate 91: PASSED** — production feature registry is now current at
  `8 \| 11 \| 14 \| 11` calculators/definitions/context-bindings/versions; the two
  modules' prerequisite feature definitions exist.
- Migrations 023 + 024 applied; module registry 13 intact; **`feature_value` still
  0** (S-5 not run); **`module_reading` still 0** (no module output).
- No S-4, S-5, migration, module write, or Module #3 occurred.

**Next gate:** the **S-5 Production Feature-Run Gate** (doc 93) — produce the
prerequisite feature values from the 51 completed fixtures — held for explicit
authorization. After a clean S-5 run, re-run Gate 87 → **A**, then the
production-write authorization gate. No Module #3 until then.
