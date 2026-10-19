// Numbers that tune the tutor, in one place. "Not measured" means chosen by judgment:
// no benchmark run (docs/benchmark.md) backs the value, so change it freely and measure after.
export const TUNING = {
  /** Learner replies on one topic after which the tutor is told to move on. Not measured. */
  moveOnTurns: 5,
  /** Exchanges on one unit point before the tutor moves to the next point. Not measured. */
  unitPointTurns: 4,
  /** Replies in a row without a grammar mistake after which the tutor is told it is too easy. Not measured. */
  easyStreak: 3,
  /** Grammar points from the next unit named in the course block. Not measured. */
  courseNextPoints: 3,
  /** Grammar points in "Grammar to revisit". Not measured. */
  maxFollowUps: 3,
  /** Grammar ids listed in the catalogue block. Not measured. */
  maxCatalogue: 60,
  /** A miss counts as recent for this long (14 days). Not measured. */
  recentMissMs: 14 * 24 * 60 * 60 * 1000,
  /** Characters of the learner's personal notes sent in the prompt. Not measured. */
  personalContextChars: 1500,
  /** Hardest Anki words named in the prompt. Not measured. */
  ankiHardest: 5,
  /** Upcoming new Anki words named in the prompt. Not measured. */
  ankiNextNew: 8,
  /** New target-language words per reply in the beginner persona, each glossed. Not measured: research gives no number. */
  beginnerNewWords: 2,
  /** Position on the level scale below which replies stay at 2 or 3 sentences. Not measured. */
  midBelow: 0.6,
  /** Hard cap on sentences when a reply brings in a target, by level. Measured: bench run 2026-10-08T05-41-04 (v0.16.1). */
  sentenceCap: { unknown: 5, beginner: 4, mid: 6, advanced: 8 },
} as const;
