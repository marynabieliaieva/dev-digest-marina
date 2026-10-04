/** First 7 chars of a commit SHA, for display. */
export function shortSha(sha: string | null | undefined): string {
  return (sha ?? "").slice(0, 7);
}
