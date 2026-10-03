import React from "react";
import { CONFIDENCE_HIGH, CONFIDENCE_MID } from "./constants";

/** ≥0.85 green / ≥0.70 amber / below red. */
export function confidenceColor(confidence: number): string {
  if (confidence >= CONFIDENCE_HIGH) return "var(--ok)";
  if (confidence >= CONFIDENCE_MID) return "var(--warn)";
  return "var(--crit)";
}

const KEYWORDS = new Set([
  "const", "let", "var", "function", "class", "interface", "extends", "implements",
  "export", "import", "from", "return", "if", "else", "for", "while", "async", "await",
  "new", "private", "public", "protected", "readonly", "static", "type", "enum",
  "this", "super", "throw", "try", "catch", "finally", "typeof", "instanceof", "void",
  "null", "undefined", "true", "false", "case", "switch", "break", "continue",
  "default", "in", "of", "yield", "get", "set", "as", "satisfies", "abstract",
]);

const TOKEN_RE =
  /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;

/** Minimal, dependency-free JS/TS token highlighter for short evidence snippets
 *  — comments/strings/numbers/keywords get a color, everything else stays plain. */
export function highlightCode(code: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(code))) {
    if (m.index > last) nodes.push(code.slice(last, m.index));
    const [full, comment, block, str, num, word] = m;
    const color = comment || block
      ? "var(--text-muted)"
      : str
        ? "var(--ok)"
        : num
          ? "var(--warn)"
          : word && KEYWORDS.has(word)
            ? "var(--accent-text)"
            : null;
    nodes.push(color ? React.createElement("span", { key: key++, style: { color } }, full) : full);
    last = m.index + full.length;
  }
  if (last < code.length) nodes.push(code.slice(last));
  return nodes;
}
