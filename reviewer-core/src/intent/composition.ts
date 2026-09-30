import { createHash } from 'node:crypto';
import type { PromptSectionStat } from '@devdigest/shared';

/** Per-section prompt stats (chars, ~tokens, sha256). Never carries the text. */
export function sectionStats(sections: { name: string; content: string }[]): PromptSectionStat[] {
  return sections.map((s) => ({
    name: s.name,
    chars: s.content.length,
    est_tokens: Math.ceil(s.content.length / 4),
    sha256: createHash('sha256').update(s.content).digest('hex'),
  }));
}
