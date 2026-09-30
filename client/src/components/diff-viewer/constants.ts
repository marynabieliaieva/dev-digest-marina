/** Constants for the DiffViewer. */

/** Files with this many or fewer changed lines start expanded. */
export const AUTO_EXPAND_MAX_LINES = 200;

/** Matches a unified-diff hunk header, e.g. `@@ -1,2 +1,3 @@`. */
export const HUNK_HEADER_RE = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Word shown next to a finding-marked line, per severity. */
export const FINDING_LINE_LABEL = {
  CRITICAL: "blocker",
  WARNING: "warning",
  SUGGESTION: "suggestion",
} as const;
