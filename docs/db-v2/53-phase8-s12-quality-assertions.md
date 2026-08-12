# Phase 8 S-12 — Quality assertions: the registry that was never seeded

**IMPLEMENTED.** Eight of seventeen registered assertions now execute and record
their results. The other nine have no implementation and **write nothing**,
because "not checked" is not "passed".

Independent of the season-statistics hold, of G-1, and of `provider_statistic`.
No migration. No schema change. No provider call.

---

## Why this, now

The critical path is stalled at **S-6**, and not by anything this session can
resolve: [doc 25](./25-phase8-s6-not-specified.md) records five blockers, the
first being that S-6 *"has no specification"* and the last that its declared
prerequisite (S-0, the `mv_*` definitions) has not been done. S-7 depends on
S-6. Inventing an evaluation rule for `module_status_code` is exactly the
mistake [doc 22](./22-phase8-s5-implementation-blocked.md) recorded for S-5.

[Doc 15](./15-phase8-application-migration-specification.md) §2 names what runs
beside the critical path: *"S-12 from S-1 onward; S-13 from S-2 onward."* S-1
through S-5 are complete. **S-12 is the unblocked track**, and §3.12 specifies it
in six lines — target, files, complexity, risk, and a testing standard.

## What was actually there

Verified against a scratch cluster carrying all 22 migrations and the S-3 seed:

| | |
|---|---|
| Assertions registered in `operations.quality_check` | **17** |
| Rows in `operations.quality_check_version` | **0** |
| Rows ever written to `operations.quality_assertion_result` | **0** |
| Assertions with an executable implementation | **8** |
| Roles permitted to EXECUTE the two database assertions | **1** — `pt_platform_admin` |

### The registry nobody seeded

`operations.quality_check_version` was created in migration 003 and **left
empty**. No migration writes it, no seed stage wrote it, and doc 15 and
[doc 18](./18-phase8-s3-seed-report.md) do not mention it — it was assigned to no
owner.

That is not cosmetic. `quality_assertion_result.quality_check_version_id` is
`NOT NULL` with a foreign key onto it, so **with the registry empty no assertion
result could be recorded at all.** The seventeen checks could have run and had
nowhere to land. `feature.feature_version` and `module.module_version` are both
seeded by S-3; this third version registry was missed.

Migration 003's comment says why it matters: *"E9.07. A changed assertion
measures something different (LC-169). Recorded on every result so that a change
in results attributable to a changed assertion is distinguishable from one
attributable to changed data."* Without it, tightening an assertion and
discovering a regression look identical in the result history.

### Verification that printed and exited

`src/v2/feature/verify.ts` holds four working controls — and returns them to the
caller. Migration 012 states the exact reason `quality_assertion_result` is
permanent: *"The previous platform had verification logic that PRINTED AND
EXITED — valuable logic whose output was not retained, so verification was a
manual act rather than a monitorable trend."* V2 had rebuilt that shape.

## What was implemented

| File | |
|---|---|
| `src/v2/seed/qualityRegistry.ts` | **new.** One `1.0.0` version per registered check |
| `src/v2/seed/runAll.ts` | one stage added, last |
| `src/v2/quality/run.ts` | **new.** The runner |
| `src/v2/quality/cli.ts`, `index.ts` | **new.** `npm run quality:v2` |
| `src/v2/config/env.test.ts` | the new entry point registered — see "the tripwire that fired" |

**The keys are read from the database, not listed in code.**
`quality_check_version.quality_check_key` carries **no** foreign key onto
`operations.quality_check`, so a typo would create a version for an assertion
that does not exist and nothing would object. Deriving the keys from the registry
makes that unrepresentable and covers a check added by a later migration without
editing the seed.

### Coverage — 8 of 17

| Assertion | Implementation |
|---|---|
| `rls_enabled_and_forced` | `fn_assert_security_posture`, step 1 |
| `snapshot_no_modification_privilege` | steps 2–3 |
| `retention_delete_privilege` | step 4 |
| `privilege_policy_correspondence` | `fn_assert_access_correspondence` |
| `feature_scale_conformance` | application, **temporary** |
| `provenance_propagation` | application, **temporary** |
| `feature_dependency_acyclic` | application, **temporary** |
| `orphan_absence` | application, **temporary** |
| *the other nine* | **none (finding S5-2)** |

Doc 15 §3.12: *"The application schedules them and records results; **it does not
reimplement them**."* Nothing here re-derives an assertion the database already
expresses.

### Three decisions worth stating

**An unimplemented check writes no row.** `passed` is `boolean NOT NULL`: there
is no "not run" state, and one was not invented. `false` would report a failure
where there is an absence; `true` would report an assertion nobody made. The
coverage gap is reported beside every result instead — the CLI prints
`NO CHECK 9` under every pass, because *"8 passed"* without *"of 17 registered"*
is the misreading that matters.

**A failure stops the assertions after it, and those record nothing.**
`fn_assert_security_posture` RAISEs on the first breach and covers three keys in
sequence. So a pass means all three held; a failure is attributed to one key by
its message, and the keys after it **never executed**. Recording those as passing
would be the most damaging thing this module could do — a green result for an
assertion that never ran. They are reported as `NOT REACHED`.

**A permission failure is not an assertion failure.** SQLSTATE `42501` or `42883`
from an assertion function aborts the run instead of being recorded. *"The
assertion found a breach"* and *"the runner was not allowed to look"* are
different facts, and reporting the second as the first would declare the platform
insecure because of a missing GRANT.

## Finding Q-1 — the runner's role cannot record its own results

**`pt_platform_admin` is the only role granted EXECUTE on either assertion
function, and migration 016 grants it only `S` on schema `operations`.** So the
one principal permitted to run these assertions is not permitted to record them.

This is **finding S3-1 in a second place**. `seed/runAll.ts` already carries it:
*"The entitlement stage's layer holds SELECT on operations and no INSERT, so that
stage runs unattributed."* There it cost attribution. Here it would cost the
deliverable.

Under the current single-login deployment the role is a label and this runs. Under
a credential-separated one the INSERT is refused with `42501`.

**Not repaired here.** The remedy is a grant, which changes the F-09 privilege
posture — and it must be applied through `fn_apply_access`, because a privilege
without a matching policy would make `privilege_policy_correspondence`, one of
the assertions this very runner executes, start failing. That is a governance
decision, and test 3 fails the moment it is taken so the finding cannot be
silently outlived.

## Proof

**15 tests, all passing.** Doc 15 §3.12 sets the standard — *"Each check detects
a deliberately introduced violation"* — and tests 9 and 10 apply it: FORCE ROW
LEVEL SECURITY is switched off on `football.team` against the real database, the
runner must detect it, name the relation, refuse to report the two assertions
after it, and **the failure must still be readable after the breach is
repaired** (E9.08: *"degradation is visible as a TREND"*).

**Six mutants, six killed** — two only after the tests were strengthened:

| Mutant | Killed by |
|---|---|
| unreached assertions reported as passed | 9 |
| the coverage gap hidden | 7 |
| the seed covers only some registered checks | 5 |
| `recordResult` stops checking its row count | 12 |
| the version precondition never fires | 11 |
| recording failures swallowed | 3a (structural) |
| a permission failure recorded as a failed assertion | 3b |

### A defect in this work, found by mutation testing

The first pass at `record()` used `INSERT … SELECT` with both foreign keys
resolved by join. **A join that matches nothing inserts nothing and raises
nothing** — a missing version would have produced a run that evaluated eight
assertions, filed none, and reported eight recorded. Precisely the silent-failure
shape this subsystem exists to detect in others.

Closed two ways: `assertVersionsRegistered` refuses to start unless every key
about to run can be filed, and `recordResult` verifies it wrote exactly one row.

### The tripwire that fired

Adding the CLI broke `env.test.ts`'s *"a fourth cannot be added unnoticed"*
assertion, which discovers self-executing modules and requires each to import the
env loader first. **It was right**: the CLI did not load it, and would have failed
in production complaining about a variable the operator had set. Both halves
fixed.

### Verification

| Check | Before | After |
|---|---|---|
| `tsc --noEmit` | clean | clean |
| suite, no database | 376 / 376 | **383 / 383** |
| suite, scratch database | 14 leaf failures | **612 tests, the identical 14** |
| `lint:reads` | 64 | **64** — none introduced |

The 14 are pre-existing and environmental: nine pool/health tests requiring each
role to authenticate as itself, five privilege-refusal tests a superuser login
cannot fail correctly.

**Live, end to end** — `npm run seed:v2` then `npm run quality:v2` against the
scratch cluster: 17 registered, 17 versioned, 8 evaluated, 8 recorded, 9 reported
as having no check, exit 0.

## What this does NOT do

- **It does not implement the nine missing assertions.** Several need S-6 or S-7
  to exist (`manifest_completeness`, `snapshot_checksum`,
  `coverage_completeness`, `module_input_conformance`); `pruning_conformance` and
  `structured_payload_conformance` need a specification nobody has written; and
  `structured_payload_conformance` in particular is PD-16's own assertion and
  must not be written while PD-16 is unresolved.
- **It does not schedule anything.** The cadence column is registered and unused;
  wiring a scheduler is a separate step.
- **It does not touch the season-statistics branch, G-1, or
  `provider_statistic`.**

---

## Status after this step

| Track | State |
|---|---|
| S-1 … S-5 | complete |
| **S-12 quality assertions** | **8 of 17 executing and recorded.** Nine unimplemented, reported |
| S-6 module generation | **BLOCKED — no specification** (doc 25). The critical path stops here |
| S-7 snapshot sealing | blocked behind S-6 |
| S-8 retention | needs S-6 |
| Season statistics | **HELD** — BEFORE captured, AFTER due after 2026-08-15 |
| G-1 / appearance family | **BLOCKED** (doc 33 §5, doc 50). Untouched |
| U-10 | **specified, awaiting the decision in doc 49 §7.** Not implemented |
| Q-1 | **open** — a grant, and a governance decision |

**The genuine blocker is S-6, and it is a specification blocker, not a provider
one.** Nothing in the season-statistics hold touches it.
