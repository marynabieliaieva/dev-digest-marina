/** The block as it will read in the assembled prompt (AC-22): heading plus one bullet per path. */
export function serializePreview(paths: string[]): string {
  return "## Project context\n" + paths.map((p) => "- " + p).join("\n");
}
