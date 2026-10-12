import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';

/**
 * Demo project-context fixture for the seeded `acme/payments-api` repo,
 * mirroring `seed-conventions.ts`. The files are written to a dedicated
 * `_seed` dir (deliberately NOT `clonePathFor()`) so a later real sync never
 * collides with them. `src/readme.md` is intentionally non-matching.
 */
export interface SeedContextDoc {
  path: string;
  content: string;
}

export const SEED_CONTEXT_DOCS: SeedContextDoc[] = [
  {
    path: 'specs/public-api.md',
    content: `# Public API

The public API is versioned and unauthenticated clients are rate limited.

- All routes live under \`/v1\`
- Errors use a typed envelope
- Breaking changes require a new major version

\`\`\`http
GET /v1/payments/{id}
\`\`\`
`,
  },
  {
    path: 'specs/security-baseline.md',
    content: `# Security baseline

Minimum controls every change must respect.

- Secrets come from the environment, never from source
- Inputs are validated at the route boundary
- Outbound HTTP uses an allow-list

\`\`\`ts
const key = process.env.STRIPE_KEY;
\`\`\`
`,
  },
  {
    path: 'specs/rate-limiting.md',
    content: `# Rate limiting

Public endpoints use a token-bucket limiter keyed by client address.

- Default: 60 requests per minute
- Exceeding the limit returns \`429\`
- Limits are configured in \`src/config.ts\`

\`\`\`ts
const limiter = tokenBucket({ capacity: 60, refillPerMin: 60 });
\`\`\`
`,
  },
  {
    path: 'docs/architecture/overview.md',
    content: `# Architecture overview

payments-api is a layered Node service.

- Routes validate and delegate
- Services hold business rules
- Repositories own persistence

\`\`\`text
route -> service -> repository -> db
\`\`\`
`,
  },
  {
    path: 'insights/incident-2026-09.md',
    content: `# Incident 2026-09

A leaked key caused a short outage.

- Root cause: a secret committed in plaintext
- Fix: rotate the key and add a secret scan
- Follow-up: enforce the security baseline in review

\`\`\`sh
git log -S sk_live_ --oneline
\`\`\`
`,
  },
  {
    path: 'src/readme.md',
    content: `# Source layout

Not a context document: it is outside the specs/docs/insights folders.

- \`middleware/\`
- \`api/\`
`,
  },
];

/**
 * Write the fixture files under `<cloneDir>/_seed/acme/payments-api` and point
 * `acme/payments-api` at them when it has no clone yet. Idempotent.
 */
export async function seedProjectContextFixture(db: Db, cloneDir: string): Promise<void> {
  const root = join(cloneDir, '_seed', 'acme', 'payments-api');
  for (const doc of SEED_CONTEXT_DOCS) {
    const file = join(root, ...doc.path.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, doc.content, 'utf8');
  }

  await db
    .update(t.repos)
    .set({ clonePath: root })
    .where(and(eq(t.repos.fullName, 'acme/payments-api'), isNull(t.repos.clonePath)));
}
