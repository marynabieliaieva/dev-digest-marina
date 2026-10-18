/** Max characters of a single file's diff section stored as an eval case's frozen input. */
export const MAX_DIFF_SECTION_CHARS = 200_000;

/** Max length of an eval case name (prefix included). */
export const CASE_NAME_MAX = 120;

/** A `running` batch older than this and absent from the in-memory queue is stale. */
export const STALE_BATCH_MS = 30 * 60_000;

/** A metric drop of at least this many points raises the dashboard alert. */
export const ALERT_DROP_PTS = 2;

/** Finding kinds that match an expectation on file equality alone. */
export const FULL_FILE_KINDS: readonly string[] = ['secret_leak', 'lethal_trifecta', 'phantom', 'hook'];
