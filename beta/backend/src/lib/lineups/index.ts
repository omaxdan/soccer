/**
 * PREDICTED LINEUPS ENGINE
 *
 * A DB-only, zero-API engine that answers, for an upcoming fixture: what shape
 * will this team play, who are the eleven, where does each of them stand, and
 * how sure are we?
 *
 * PIPELINE
 *
 *   candidates.ts       raw player + season stats  ->  scored PlayerCandidates
 *                       (availability.ts filters the input first)
 *   formationScoring.ts every formation in the catalogue solved independently
 *   optimizer.ts        Hungarian maximum-weight assignment per formation
 *   assembly.ts         confidence, depth-chart ranks, captaincy
 *
 * The modules are deliberately independent of the database and of each other's
 * internals — processPredictedLineups() supplies the data and persists the
 * result, and processStartingXIStrength() reuses the same formation and
 * suitability logic so the two engines can never drift into disagreeing about
 * what a lineup is.
 */

export * from './types';
export * from './positions';
export * from './formations';
export * from './playerScoring';
export * from './availability';
export * from './optimizer';
export * from './candidates';
export * from './formationScoring';
export * from './confidence';
export * from './assembly';
