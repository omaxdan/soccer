# League Performance & Gap Analytics — Technical Specification

**Platform:** NinetyData RIP (Readiness Intelligence Platform)
**Status:** Design proposal — no implementation yet
**Framing:** Neutral accuracy analytics. This feature measures and presents *how well the platform's readiness gaps have historically tracked real outcomes, per league*. It is an accountability and calibration layer, not a capital-allocation or betting-advisory tool. Every metric is a backtestable fact about the platform's own past predictions; the user draws their own conclusions.

---

## 0. Scope and guiding principle

This document specifies three things:

1. A **permanent, append-only archive** (`readiness_history`) that captures the platform's pre-match readiness state for every fixture, before kickoff, immutably.
2. A **verification and aggregation layer** that joins that archive to real results and measures per-league, per-gap-tier predictive accuracy.
3. A **read-only analytics page** that surfaces those measurements in the platform's existing dark, minimalist aesthetic.

The single most important design constraint, from which several others follow: **the archive must be written pre-match and never rewritten after the fact.** If the "prediction" a fixture is scored against was regenerated or updated after the result was known, the entire accuracy layer silently measures nothing. Immutability of the pre-match snapshot is not a nice-to-have; it is the feature.

A note on framing that shapes the schema and UI below: the deliverable as originally scoped used trading language ("ROI," "Green Light Leagues," "invest capital," "Danger Zone"). This spec deliberately reframes those to neutral, factual equivalents ("Hit Rate," "Historically Consistent," "Historically Volatile"), consistent with the platform's established principle of presenting raw analytical facts rather than directional recommendations — the same principle under which the Prediction card and Signals/Recommendations tabs were previously removed. The underlying measurement engine is identical either way; only the presentation changes. Where a metric is inherently advisory or unmeasurable with current data (notably true ROI, which requires odds/stake data the platform does not store), this document says so explicitly and proposes an honest substitute.

---

## 1. Data collection and the `readiness_history` table

### 1.1 What the archiver captures, and when

**Trigger:** a nightly job, running after the day's data sync and processing have completed, as a new stage appended to the existing cron sequence (see §1.5). It does *not* need its own always-on process.

**What it snapshots:** every fixture that is (a) scheduled, (b) not yet started, and (c) has readiness intelligence computed for both teams at that moment. Concretely, this is the set of upcoming matches whose `match_intelligence` (or, as a documented fallback, both teams' baseline `team_intelligence`) is populated. The snapshot captures the *current* readiness picture for those future fixtures — this is what makes it genuinely pre-match.

**What it does not do:** it never touches, updates, or recomputes a row for a match that already has a snapshot. One immutable snapshot per match, written once, at the earliest night on which that fixture had complete pre-match readiness data.

### 1.2 Immutability and idempotency (critical)

- `match_id` carries a **UNIQUE constraint** in `readiness_history`. One row per fixture, forever.
- The archiver writes with **first-write-wins / insert-if-absent** semantics — never upsert-overwrite. If a match already has a snapshot, it is skipped entirely. This guarantees the stored prediction is the *first* complete pre-match reading, not a later one contaminated by results or by intervening re-processing.
- Rows are **append-only by policy**: no application code path updates a `readiness_history` row after insert except the single, narrowly-scoped result-linking step in §1.4, which writes *only* result-derived columns and never the prediction columns.

This is the structural guarantee that the whole accuracy layer depends on. It should be enforced at the database level (unique constraint + a row-level policy or a deliberately restricted service path), not left to application discipline alone.

### 1.3 `readiness_history` — column model

Values are captured **verbatim from the match row at snapshot time**. This is a denormalized, point-in-time archive on purpose — it must preserve what the platform believed *then*, even if teams are renamed, leagues re-tiered, or the readiness formula later changes. Do not replace these with live foreign-key lookups to current values; that would defeat the archive.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `id` | bigint identity | no | PK |
| `match_id` | bigint | no | **UNIQUE.** Internal `matches.id`, not `external_match_id`. The join key to results. |
| `match_external_id` | bigint | no | Captured too, so the archive is traceable to source even if internal IDs are ever migrated |
| `snapshot_at` | timestamptz | no | When this pre-match reading was taken. Distinct from `match_date` |
| `match_date` | timestamptz | no | Scheduled kickoff, verbatim |
| `league_name` | text | no | Verbatim from `matches.competition` (a denormalized text field on the platform — captured as text on purpose, see §1.6) |
| `home_team` | text | no | Team name verbatim at snapshot time |
| `away_team` | text | no | Team name verbatim at snapshot time |
| `home_team_id` | bigint | no | Retained for optional later joins, but display uses the verbatim text above |
| `away_team_id` | bigint | no | |
| `home_readiness` | numeric | no | Verbatim readiness at snapshot |
| `away_readiness` | numeric | no | Verbatim readiness at snapshot |
| `predicted_gap` | numeric | no | **Signed, oriented to `predicted_pick`** — see §1.3.1. This is the field the gap tiers bucket on |
| `predicted_pick` | text (enum-like) | no | `HOME` / `AWAY` / `DRAW` — see §1.3.2. An internal analytical record of which side the readiness gap favored at snapshot time, used solely to score accuracy. Not re-surfaced to users as a recommendation |
| `confidence_pct` | numeric | no | Platform confidence score at snapshot, verbatim |
| `squad_versatility` | numeric | **YES — nullable** | Optional. Tactical-flexibility / depth proxy. Explicitly NULL when the metric was not tracked for that league/tier/match at snapshot time. See §2.3 |
| `defense_confidence_pct` | numeric | yes | Pre-match predicted-lineup confidence for the defensive department at snapshot. Nullable — a fixture may not have a predicted lineup computed |
| `midfield_confidence_pct` | numeric | yes | As above, midfield |
| `attack_confidence_pct` | numeric | yes | As above, attack |
| `readiness_formula_version` | text | no | Which version of the readiness/gap formula produced these numbers. Essential: the formula evolves, and a fair accuracy comparison must know whether two rows are even measuring the same thing |
| **Result-linked columns (written later, once, by §1.4):** | | | |
| `result_linked_at` | timestamptz | yes | NULL until the match finishes and is linked |
| `final_home_score` | integer | yes | Copied from `match_results` at link time |
| `final_away_score` | integer | yes | |
| `final_outcome` | text (enum-like) | yes | `HOME` / `AWAY` / `DRAW`, derived from the scores |
| `pick_correct_strict` | boolean | yes | `predicted_pick == final_outcome` (draws count as their own outcome). See §2.1 |
| `pick_correct_lenient` | boolean | yes | Higher-readiness side did not *lose* (win-or-draw counts as correct). See §2.1 |

#### 1.3.1 Orientation of `predicted_gap` — a decision the whole tiering depends on

The four gap tiers only mean something if `predicted_gap` has one unambiguous, documented orientation. This spec defines it as **signed relative to `predicted_pick`**:

- **Positive** — the picked side had the higher readiness; the pick *agrees* with the readiness gap. Larger positive = stronger readiness backing.
- **Negative** — the picked side had the *lower* readiness; the pick was driven by a non-readiness factor (e.g. home advantage tipping the platform's favorite despite an away-readiness edge). This is precisely the "Negative Edge" tier.

This orientation is what makes "Negative Edge" analytically meaningful: it isolates the fixtures where the platform's pick *contradicted* its own readiness signal, so their historical accuracy can be measured separately. If the orientation is left ambiguous, the entire tier breakdown is noise. This must be pinned down before any archiving code is written.

#### 1.3.2 Draws are a first-class outcome, not an afterthought

Football has draws; a binary `HOME`/`AWAY` model cannot honestly score itself. The archive therefore:

- Stores the **raw final scores**, so any outcome definition can be recomputed later without re-snapshotting.
- Computes **two** correctness columns (`pick_correct_strict` and `pick_correct_lenient`, §2.1) rather than pretending there is one right answer.
- Permits `predicted_pick = DRAW` when the readiness gap is within a near-zero band (threshold to be set as a documented constant), rather than forcing a side.

Hiding draws inside a two-way accuracy number is the most common way this kind of backtest lies to itself. The spec makes them explicit.

### 1.4 Linking to `match_results`

A second, separate nightly stage (or a step within the same job, run *after* the snapshot stage) handles finalization:

1. Select `readiness_history` rows where `result_linked_at IS NULL` **and** the corresponding match now has a completed `match_results` row (status finished, both scores present).
2. For each, join on `match_id` and write *only* the result-linked columns from §1.3.
3. Derive `final_outcome` from the scores; compute `pick_correct_strict` and `pick_correct_lenient`.
4. Set `result_linked_at`.

This step writes result columns exactly once per row and **never** touches the prediction columns. That separation is what preserves the pre-match guarantee: prediction data is frozen at snapshot; result data is appended later; the two never mix in a single writable operation.

Matches that are postponed/cancelled/abandoned are left unlinked indefinitely (their `result_linked_at` stays NULL) and are simply excluded from accuracy aggregates — consistent with how the platform already treats inactive-status matches elsewhere.

### 1.5 Where this fits in the existing architecture

The platform's backend is a Node/TypeScript + Supabase job runner driven by CLI commands (`process:*`, `sync:*`), precomputing everything so the frontend does zero runtime calculation. There is no always-on HTTP server; scheduled work runs as discrete CLI invocations (via node-cron and/or the external "alarm-clock" trigger pattern under discussion).

This feature adds:

- One new **archive stage** — conceptually `archive:readiness-snapshot` — appended to the nightly sequence, *after* sync and `process` stages have finished, so it snapshots fully-computed readiness.
- One new **finalization stage** — conceptually `archive:link-results` — that can run in the same nightly window or on its own cadence, linking any newly-finished matches.
- Optionally, a **materialized aggregate refresh** (`analytics:refresh-league-gap`, §2.5) so the analytics page reads pre-aggregated rows rather than scanning the full history on every page load.

No new runtime infrastructure is required. It is three more precompute stages in the pattern the platform already uses.

### 1.6 Why `league_name` is stored as text, not a foreign key

On this platform, `matches.competition` is a denormalized text field, not a foreign key to `tournaments`. The archive follows suit deliberately: it captures the league label *as it was at snapshot time*. If leagues are later renamed, re-tiered, or re-keyed, historical accuracy rows must still reflect the label under which the prediction was actually made. A live FK to `tournaments` would retroactively rewrite history. (If a stable league identity is wanted for grouping across renames, capture *both* the verbatim text and a best-effort `tournament_id` — the text is the source of truth for the archive; the id is a convenience for joins.)

---

## 2. Analytical logic and gap verification

### 2.1 Was the prediction correct? — two honest definitions

For each result-linked row:

- **Strict:** `pick_correct_strict = (predicted_pick == final_outcome)`. A `HOME` pick is correct only if home won outright; a draw is a miss. This is the demanding definition.
- **Lenient:** `pick_correct_lenient = (the higher-readiness side did not lose)`. A `HOME` pick is correct if home won or drew. This measures "did the readiness edge at least hold up," which is often the more meaningful question for a readiness model.

Both are stored. The analytics layer reports **both**, side by side, and never silently picks one — because the gap between them is itself informative (a league where strict and lenient accuracy diverge sharply is a draw-heavy league, which is a real, useful fact).

### 2.2 Aggregating accuracy by league and gap tier

The core aggregation groups result-linked rows by `league_name` × **gap tier**, where the four tiers bucket on the signed `predicted_gap` (§1.3.1):

| Tier | Band (signed `predicted_gap`) | Meaning |
|---|---|---|
| Strong Edge | ≥ 20 | Pick strongly backed by readiness |
| Moderate Edge | 10 – <20 | Pick moderately backed by readiness |
| Small Edge | 0 – <10 | Pick weakly backed by readiness |
| Negative Edge | < 0 | Pick *contradicts* the readiness gap (non-readiness factor drove it) |

For each (league × tier) cell, compute:

- **Total Picks** — count of result-linked rows in the cell. *Every rate below is meaningless without this being large enough; see §2.6 on minimum sample size.*
- **Hit Rate (strict)** and **Hit Rate (lenient)** — share correct under each definition.
- **Average Winning Gap** — mean `predicted_gap` among the *correct* picks (how strong the edge was on the picks that landed).
- **Average Losing Gap** — the same among incorrect picks. The delta between these two is a calibration signal: if losing picks had gaps as large as winning ones, the gap isn't discriminating in that league.
- **Baseline and Lift** — see §2.4.

The same aggregation is also produced **per league across all tiers** (for the main matrix) and **per tier across all leagues** (for the "which tier is most reliable overall" summary).

Grouping is dynamic: leagues and tiers are not hardcoded lists — they emerge from the data, so a newly-tracked league appears automatically once it has linked rows.

### 2.3 The `squad_versatility` correlation — handling NULLs honestly

Because `squad_versatility` is explicitly nullable (not tracked for every league/tier yet), the analysis must never treat "absent" as "zero." The logic:

1. **Segment, don't impute.** Split result-linked rows into `versatility_present` (non-NULL) and `versatility_absent` (NULL). Report accuracy separately for each. Never fill NULLs with 0 or a mean — that would fabricate a signal.
2. Within `versatility_present`, bucket the metric (e.g. low / medium / high bands) and measure hit rate per band, per league where sample size allows. The question being answered: *does higher tactical versatility correlate with the readiness gap holding up?*
3. **Report coverage explicitly.** Every versatility-based figure is annotated with what fraction of the cell actually had the metric (e.g. "versatility available for 41% of these fixtures"). A correlation drawn from 41% coverage is a hypothesis, not a conclusion, and the UI must say so.
4. Because coverage will be uneven across leagues, versatility correlations are surfaced as a **secondary, clearly-caveated panel**, not mixed into the primary hit-rate matrix where they'd imply a completeness that doesn't exist.

### 2.4 Positional confidence as a failure-isolation tool

When a **high-gap prediction loses** (Strong or Moderate Edge, `pick_correct_strict = false`), the three department confidences (`defense_/midfield_/attack_confidence_pct`) captured at snapshot let us ask *where the read broke down*:

- For the set of high-gap losses in a league, compute the **average department confidence profile** and compare it to the same profile for high-gap *wins*. A department that is systematically lower-confidence among the losses is a candidate structural weak point — e.g. "in this league, strong-gap picks that lost had markedly lower pre-match attack confidence than those that won."
- Cross-reference with the **actual score pattern** (also archived): high-gap losses where the picked side *conceded heavily* point at defensive-confidence failures; losses where the picked side *failed to score* point at attack-confidence failures. Because the archive stores raw final scores, this correlation is computable without any additional data capture.
- This is explicitly **diagnostic, not predictive**. It explains, retrospectively and factually, which department's pre-match uncertainty coincided with failures — helping refine the model or the lineup predictor. It is not turned into a forward-looking "avoid this department" signal.

Departments with NULL confidence (no predicted lineup that night) are excluded from this analysis for that fixture, and their exclusion rate is reported alongside — same NULL-honesty discipline as §2.3.

### 2.5 Where the aggregation lives

Two viable approaches; the spec recommends the second:

- **On-read:** the analytics page runs the aggregation query against `readiness_history` live. Simplest, always current, but scans grow with history.
- **Materialized (recommended):** a nightly `analytics:refresh-league-gap` stage writes the per-(league × tier) aggregates into a small `league_gap_analytics` summary table (and a companion `league_gap_summary` for the top-level cards). The page reads pre-aggregated rows. This matches the platform's precompute-everything architecture, keeps the page instant, and means the expensive grouping runs once per night, not once per visitor. The summary table carries its own `computed_at` so the UI can show data freshness, exactly as other RIP surfaces already do.

### 2.6 Minimum sample size — the honesty gate

A hit rate over 4 fixtures is noise dressed as insight. This is the same lesson already learned elsewhere on the platform (the match-center minimum-games filter). Therefore:

- Every (league × tier) cell carries its `total_picks`.
- Cells below a documented threshold (proposed: **N ≥ 30** for a headline rate, with a softer **N ≥ 10** "provisional" band) are **not** given a confident status badge. They render as "Insufficient sample" rather than a misleadingly precise percentage.
- The top-level summary cards (§3.1) are drawn **only** from cells meeting the full threshold. A "highest hit-rate league" computed from 6 fixtures would be exactly the kind of false precision this platform avoids.

This gate is not optional polish; it is what keeps the whole feature honest.

### 2.7 On "ROI" specifically

True ROI (return on staked capital) cannot be computed from anything the platform currently stores — it requires odds and stake data that do not exist in the schema. Reporting a number labeled "ROI" without odds would be both **inaccurate** (it isn't ROI) and **advisory** (it frames the page as a capital-allocation tool). This spec therefore **replaces ROI with `Hit Rate` and `Lift over Baseline`**:

- **Baseline** = the naive accuracy you'd get with no model — e.g. always picking the home side, or picking at the league's base rate. Computed per league from the archive itself.
- **Lift over Baseline** = how much the readiness-gap pick beats that naive baseline, in percentage points. *This* is the honest, model-relevant, non-advisory answer to "is the signal actually worth anything in this league" — and it's more informative than ROI because it isolates the model's contribution from the league's inherent predictability.

If odds data is ever added to the platform, an honest "historical edge vs closing odds" becomes computable and could be added as a factual measurement — but that is a separate, future decision, and still a measurement rather than a recommendation.

---

## 3. Front-end UI/UX — "League Analytics" page

Aesthetic: the platform's existing dark-first, grey-and-white minimalist system — CSS-variable theming (light/dark), `rem`-based sizing, JetBrains Mono for all numeric/tabular columns, class-based styling, `TeamCrest`/crest and `FormString`-style pill components reused where relevant, horizontal-scroll tab/table patterns on mobile. The page is **read-only** and strictly informational.

### 3.1 Top-level summary — three highlight cards

A row of three cards (stacking to one column on mobile, per the platform's established responsive pattern). Reframed from the original "ROI / reliable / high-risk" trio to neutral equivalents:

1. **Most Consistent League** — highest lift-over-baseline among leagues meeting the sample-size gate. Card shows league name/crest, hit rate (strict + lenient), lift, and sample size. *Label is descriptive ("most consistent historically"), never "invest here."*
2. **Most Reliable Signal Tier** — across all leagues, which gap tier held up best (e.g. "Strong Edge picks landed 68% strict, N=1,240"). Answers "when the platform is most confident, how has that actually played out."
3. **Highest-Variance League** — the volatility/consistency alert. The league whose tier hit-rates are most erratic or most below baseline, flagged **factually** ("readiness gaps have historically been least reliable here"), never as a "danger/trap." Includes sample size so the flag itself can't be noise.

Each card carries a data-freshness timestamp (`computed_at` from §2.5).

### 3.2 Core data matrix

A sortable table, one row per league (meeting the sample gate; sub-threshold leagues optionally shown greyed under a "provisional" toggle). Numeric columns in JetBrains Mono, right-aligned, consistent with existing RIP tables.

Columns:

| Column | Notes |
|---|---|
| League | name + crest (reusing `TeamCrest`-style logo handling / league logo work already in the platform) |
| Total Picks | the sample-size anchor; sorting defaults here so users see well-evidenced leagues first |
| Hit Rate % (strict) | |
| Hit Rate % (lenient) | shown alongside strict, not instead of — the divergence is informative (§2.1) |
| Lift over Baseline | replaces "ROI %" (§2.7) |
| Avg Winning Gap | mean gap on correct picks |
| Readiness Status | a badge — **reframed** from "Stable / Volatile / High Risk" to factual **Consistent / Mixed / Volatile**, derived from lift + variance + sample size. A league below the sample gate shows "Insufficient sample," never a confident badge |

Sorting is user-driven on every numeric column. Row expansion (or a detail drill-in) reveals that league's **per-gap-tier breakdown** (the four tiers with their individual hit rates and sample sizes) plus the §2.4 department-confidence failure profile and the §2.3 versatility panel with its coverage caveats.

### 3.3 Filter toggles — reframed

The original "Green Light Leagues (invest capital)" / "Danger Zone (coin-flip traps)" toggles are reframed to neutral filters that isolate the same rows without the capital-allocation framing:

- **"Historically Consistent"** — leagues where the readiness gap has beaten baseline reliably and with a sufficient sample. (The same set the "green light" filter would have surfaced — presented as a factual track record, not an investment instruction.)
- **"Historically Volatile"** — leagues where gaps have underperformed or swung erratically. (The same set as "danger zone" — presented as "the model has been unreliable here," letting the user decide what to do with that, including not betting at all.)
- Secondary filters: by gap tier (show only Strong-Edge performance across leagues), by versatility coverage (only leagues where the versatility metric is well-covered), and by minimum sample size (raise/lower the confidence gate).

The distinction that matters throughout: the page tells the user *what has actually happened* — per league, per tier, with sample sizes and freshness and honest NULL handling — and stops there. It does not tell them where to put money. That boundary is the reason the measurement engine is worth building in the first place: an accountability layer only has value if it reports the losses as plainly as the wins.

---

## 4. Build sequence (suggested)

1. **Schema** — create `readiness_history` with the unique constraint and append-only enforcement. This is the foundation; get the immutability guarantee right before anything writes to it.
2. **Archive stage** — the nightly pre-match snapshot writer (insert-if-absent), added to the existing cron sequence after processing completes. Begin accumulating history immediately; the analytics are only as good as the depth of archive, so this should start running as early as possible even before the UI exists.
3. **Finalization stage** — the result-linking writer.
4. **Aggregation** — the materialized `league_gap_analytics` / `league_gap_summary` tables + nightly refresh, including the sample-size gate and baseline/lift computation.
5. **Analytics page** — summary cards, sortable matrix, drill-ins, neutral filters.

Steps 1–2 have standalone value the day they ship (the archive becomes a permanent, honest record of the platform's predictions) and should not wait on the UI. The analytical value compounds with time, so earlier is materially better.

---

## 5. Open decisions for the team

- **Draw threshold** for `predicted_pick = DRAW` (the near-zero gap band) — needs a documented constant.
- **Sample-size thresholds** (proposed 30 headline / 10 provisional) — confirm against expected fixture volumes per league.
- **Baseline definition** — always-home vs league-base-rate vs higher-readiness-side. Recommend league-base-rate as the fairest, but it's a team call.
- **Formula-version handling** — whether accuracy is reported per formula version separately, or pooled with a version annotation. Pooling across a major formula change would compare things that aren't the same; at minimum the UI should expose which versions a figure spans.
- **Versatility banding** — the low/med/high cut points for §2.3, once real coverage is known.
