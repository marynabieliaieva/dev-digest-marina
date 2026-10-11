import type { PrBriefDropped, PrBriefGeneration, Risk, RiskSeverity, ReviewFocusItem } from '@devdigest/shared';
import { MAX_REVIEW_FOCUS, MAX_RISKS } from './constants.js';

export interface BriefValidationInput {
  /** PR file path -> new-side line ranges. */
  prFiles: Map<string, Array<[number, number]>>;
  /** Blast caller files and changed-symbol files. */
  blastFiles: Set<string>;
  /** Blast caller file -> caller lines. */
  callerLines: Map<string, Set<number>>;
}

export interface ValidatedBrief {
  summary: string;
  risks: Risk[];
  review_focus: ReviewFocusItem[];
  dropped: PrBriefDropped;
}

const normalizePath = (p: string): string => p.replace(/^(?:\.?\/)+/, '');

const SEVERITY_RANK: Record<RiskSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Drops every model claim that does not point at a real file / line (AC-23). */
export function validateBriefOutput(output: PrBriefGeneration, input: BriefValidationInput): ValidatedBrief {
  const prFiles = new Map<string, Array<[number, number]>>();
  for (const [p, r] of input.prFiles) prFiles.set(normalizePath(p), r);
  const blastFiles = new Set([...input.blastFiles].map(normalizePath));
  const callerLines = new Map<string, Set<number>>();
  for (const [p, s] of input.callerLines) callerLines.set(normalizePath(p), s);

  const isKnown = (f: string) => prFiles.has(f) || blastFiles.has(f);
  const dropped: PrBriefDropped = { risks: 0, risk_file_refs: 0, review_focus: 0 };

  const kept: Risk[] = [];
  for (const risk of output.risks) {
    const refs: string[] = [];
    for (const raw of risk.file_refs) {
      const f = normalizePath(raw);
      if (isKnown(f)) refs.push(f);
      else dropped.risk_file_refs++;
    }
    if (risk.file_refs.length > 0 && refs.length === 0) {
      dropped.risks++;
      continue;
    }
    kept.push({ ...risk, file_refs: refs });
  }
  kept.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]); // stable
  dropped.risks += Math.max(0, kept.length - MAX_RISKS);
  const risks = kept.slice(0, MAX_RISKS);

  const focus: ReviewFocusItem[] = [];
  for (const item of output.review_focus) {
    const f = normalizePath(item.file);
    const inRange = prFiles.get(f)?.some(([s, e]) => item.line >= s && item.line <= e) ?? false;
    const isCaller = callerLines.get(f)?.has(item.line) ?? false;
    if (isKnown(f) && (inRange || isCaller)) focus.push({ ...item, file: f });
    else dropped.review_focus++;
  }
  dropped.review_focus += Math.max(0, focus.length - MAX_REVIEW_FOCUS);

  return { summary: output.summary, risks, review_focus: focus.slice(0, MAX_REVIEW_FOCUS), dropped };
}
