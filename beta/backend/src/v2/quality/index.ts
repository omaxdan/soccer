// S-12 quality assertions.
//
// The runner and its report. The assertions themselves live in the database
// (`operations.fn_assert_security_posture`, `fn_assert_access_correspondence`)
// and in the temporary application controls of `src/v2/feature/verify.ts`.
// Nothing in this subsystem reimplements an assertion.
export {
  runQualityAssertions,
  IMPLEMENTED_KEYS,
  QUALITY_ROLE,
  type AssertionOutcome,
  type QualityRunReport,
} from './run';
