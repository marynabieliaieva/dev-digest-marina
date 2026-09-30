import { describe, it, expect } from 'vitest';
import { classifyFile, selectLatestReviews, buildSmartDiff } from './helpers.js';
import { ROLE_ORDER } from './constants.js';
import type { SmartDiffRole } from '@devdigest/shared';

const CASES: [string, SmartDiffRole][] = [
  // boilerplate
  ['server/pnpm-lock.yaml', 'boilerplate'],
  ['client/package-lock.json', 'boilerplate'],
  ['yarn.lock', 'boilerplate'],
  ['Cargo.lock', 'boilerplate'],
  ['dist/bundle.js', 'boilerplate'],
  ['client/build/out.js', 'boilerplate'],
  ['client/src/__tests__/__snapshots__/x.snap', 'boilerplate'],
  ['a/b/thing.snap', 'boilerplate'],
  ['src/api.generated.ts', 'boilerplate'],
  ['public/vendor.min.js', 'boilerplate'],
  // tests
  ['server/src/foo.test.ts', 'tests'],
  ['client/src/Foo.test.tsx', 'tests'],
  ['server/src/x.it.test.ts', 'tests'],
  ['server/src/foo.spec.ts', 'tests'],
  ['server/test/setup-env.ts', 'tests'],
  ['pkg/tests/helper.ts', 'tests'],
  ['client/src/__tests__/util.ts', 'tests'],
  ['e2e/run.ts', 'tests'],
  ['e2e/README.md', 'tests'],
  // wiring
  ['server/src/modules/index.ts', 'wiring'],
  ['client/src/lib/index.js', 'wiring'],
  ['client/next.config.ts', 'wiring'],
  ['vitest.config.ts', 'wiring'],
  ['server/tsconfig.json', 'wiring'],
  ['tsconfig.build.json', 'wiring'],
  ['.eslintrc.json', 'wiring'],
  ['.env.example', 'wiring'],
  ['docker-compose.yml', 'wiring'],
  ['.github/workflows/ci.yml', 'wiring'],
  ['.claude/skills/security/SKILL.md', 'wiring'],
  // docs
  ['README.md', 'docs'],
  ['docs/plans/smart-diff.md', 'docs'],
  ['server/README.md', 'docs'],
  ['CHANGELOG.md', 'docs'],
  ['LICENSE', 'docs'],
  ['notes/todo.md', 'docs'],
  // core
  ['server/src/modules/intent/service.ts', 'core'],
  ['client/src/app/page.tsx', 'core'],
  ['server/src/db/schema/pulls.ts', 'core'],
  // separators
  ['server\\pnpm-lock.yaml', 'boilerplate'],
  ['server\\src\\modules\\index.ts', 'wiring'],
];

describe('classifyFile', () => {
  it.each(CASES)('%s -> %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });
});

describe('selectLatestReviews', () => {
  const mk = (id: string, agentId: string | null, kind: 'review' | 'summary', t: number) => ({
    id,
    agentId,
    kind,
    createdAt: new Date(t),
    findings: [],
  });

  it('keeps only the newest review per agent and ignores summaries', () => {
    const out = selectLatestReviews([
      mk('old-a', 'a', 'review', 1),
      mk('new-a', 'a', 'review', 3),
      mk('b', 'b', 'review', 2),
      mk('sum', 'a', 'summary', 9),
      mk('n1', null, 'review', 1),
      mk('n2', null, 'review', 2),
    ]);
    expect(out.map((r) => r.id).sort()).toEqual(['b', 'n2', 'new-a']);
  });
});

describe('buildSmartDiff', () => {
  it('always emits 5 groups in ROLE_ORDER', () => {
    const d = buildSmartDiff([], []);
    expect(d.groups.map((g) => g.role)).toEqual([...ROLE_ORDER]);
  });
});
