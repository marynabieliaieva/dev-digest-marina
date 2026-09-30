import type { SmartDiffRole } from '@devdigest/shared';

/** Display order of the Smart Diff groups; every response has exactly these 5, in this order. */
export const ROLE_ORDER = ['core', 'tests', 'wiring', 'docs', 'boilerplate'] as const satisfies readonly SmartDiffRole[];

export interface RoleRule {
  role: SmartDiffRole;
  patterns: RegExp[];
}

/**
 * Classification rules, checked in order — the FIRST matching rule wins; `core`
 * is the fallback. Patterns run against the normalised path (backslashes → `/`),
 * basename rules match at any depth.
 */
export const ROLE_RULES: RoleRule[] = [
  {
    role: 'boilerplate',
    patterns: [
      /\.lock$/,
      /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/,
      /(^|\/)(dist|build)\//,
      /(^|\/)__snapshots__\//,
      /\.snap$/,
      /\.generated\./,
      /\.min\.js$/,
    ],
  },
  {
    role: 'tests',
    patterns: [
      /\.(test|spec)\.tsx?$/,
      /(^|\/)(test|tests|__tests__)\//,
      /^e2e\//,
    ],
  },
  {
    role: 'wiring',
    patterns: [
      /(^|\/)index\.(ts|js)$/,
      /(^|\/)[^/]*\.config\.[^/]*$/,
      /(^|\/)tsconfig[^/]*\.json$/,
      /(^|\/)\.eslintrc[^/]*$/,
      /(^|\/)\.env[^/]*$/,
      /(^|\/)docker-compose[^/]*\.ya?ml$/,
      /^\.github\//,
      /^\.claude\//,
    ],
  },
  {
    role: 'docs',
    patterns: [
      /\.md$/,
      /^docs\//,
      /(^|\/)README[^/]*$/,
      /(^|\/)CHANGELOG[^/]*$/,
      /(^|\/)LICENSE$/,
    ],
  },
];

export const FALLBACK_ROLE: SmartDiffRole = 'core';
