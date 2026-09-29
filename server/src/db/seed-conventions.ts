import type { ConventionCategory } from '@devdigest/shared';

/**
 * Demo conventions for the seeded `acme/payments-api` repo, mirroring
 * `seed-skills.ts`. `payments-api` has no real clone on disk (`clonePath`
 * is null — see seed.ts), so these cite the same file paths already seeded
 * for PR #482 (`pr_files`) with representative snippets: the goal is a
 * working page + e2e fixture with no API key, not a live-grounded scan.
 */
export interface SeedConvention {
  category: ConventionCategory;
  rule: string;
  evidencePath: string;
  evidenceLine: number;
  evidenceSnippet: string;
  confidence: number;
}

export const SEED_EXTRACTION = {
  sampledFiles: 9,
  candidatesRaw: 6,
  candidatesKept: 4,
  provider: 'openai',
  model: 'gpt-5.4',
} as const;

export const SEED_CONVENTIONS: SeedConvention[] = [
  {
    category: 'error_handling',
    rule: 'Async route handlers wrap external calls in try/catch and rethrow as a typed error subclass.',
    evidencePath: 'src/middleware/ratelimit.ts',
    evidenceLine: 14,
    evidenceSnippet: 'try {\n  await checkLimit(key);\n} catch (err) {\n  throw new RateLimitError(key);\n}',
    confidence: 0.91,
  },
  {
    category: 'validation',
    rule: 'Request bodies are validated with a Zod schema at the route boundary before reaching the service.',
    evidencePath: 'src/api/users.ts',
    evidenceLine: 22,
    evidenceSnippet: 'const body = CreateUserBody.parse(req.body);',
    confidence: 0.88,
  },
  {
    category: 'naming',
    rule: 'Config values are read once into a frozen `config` object rather than accessed via process.env at call sites.',
    evidencePath: 'src/config.ts',
    evidenceLine: 8,
    evidenceSnippet: 'export const config = Object.freeze({\n  port: 3000,\n  stripeKey: process.env.STRIPE_KEY,\n});',
    confidence: 0.83,
  },
  {
    category: 'logging',
    rule: 'Webhook handlers log the event type and delivery id before processing, so failures are traceable from the provider dashboard.',
    evidencePath: 'src/api/public/webhooks.ts',
    evidenceLine: 19,
    evidenceSnippet: "log.info({ event: evt.type, deliveryId }, 'received webhook');",
    confidence: 0.65,
  },
];
