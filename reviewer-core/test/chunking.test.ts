import { describe, it, expect } from 'vitest';
import type { LLMProvider, StructuredResult, UnifiedDiff } from '@devdigest/shared';
import { packChunks, reviewPullRequest } from '../src/index.js';

/** Build a synthetic diff of `n` files, each with `lines` added lines. */
function makeDiff(n: number, lines: number): UnifiedDiff {
  const parts: string[] = [];
  const files: UnifiedDiff['files'] = [];
  for (let i = 0; i < n; i++) {
    const path = `src/f${i}.ts`;
    const body = Array.from({ length: lines }, (_, j) => `+const v${j} = ${j};`).join('\n');
    parts.push(`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1,${lines} @@\n${body}`);
    files.push({
      path,
      additions: lines,
      deletions: 0,
      hunks: [
        { file: path, oldStart: 0, oldLines: 0, newStart: 1, newLines: lines, newLineNumbers: [] },
      ],
    });
  }
  return { raw: parts.join('\n'), files };
}

describe('packChunks', () => {
  it('packs small files together and keeps every file exactly once', () => {
    const diff = makeDiff(10, 20);
    const chunks = packChunks(diff, 600);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(10);
    for (const f of diff.files) {
      expect(chunks.filter((c) => c.diffText.includes(`diff --git a/${f.path} `))).toHaveLength(1);
    }
  });

  it('gives an oversized file its own chunk instead of splitting it', () => {
    const chunks = packChunks(makeDiff(3, 200), 50);
    expect(chunks).toHaveLength(3);
  });
});

describe('reviewPullRequest token guard', () => {
  const empty = { verdict: 'approve', summary: '', score: 100, findings: [] };
  function counting() {
    const calls: number[] = [];
    const llm: LLMProvider = {
      id: 'openai',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        calls.push(req.messages.length);
        return { data: empty as unknown as T, model: req.model, tokensIn: 1, tokensOut: 1, costUsd: 0, raw: '', attempts: 1 };
      },
    };
    return { llm, calls };
  }

  it('chunks a single-pass diff above the ceiling', async () => {
    const { llm, calls } = counting();
    const out = await reviewPullRequest({
      systemPrompt: 's',
      model: 'm',
      diff: makeDiff(10, 20),
      llm,
      strategy: 'single-pass',
      maxSinglePassTokens: 600,
    });
    expect(out.mode).toBe('map-reduce');
    expect(calls.length).toBe(out.chunks.length);
    expect(calls.length).toBeGreaterThan(1);
  });

  it('keeps one call when under the ceiling', async () => {
    const { llm, calls } = counting();
    const out = await reviewPullRequest({
      systemPrompt: 's',
      model: 'm',
      diff: makeDiff(3, 5),
      llm,
      strategy: 'single-pass',
    });
    expect(out.mode).toBe('single-pass');
    expect(calls).toHaveLength(1);
  });
});
