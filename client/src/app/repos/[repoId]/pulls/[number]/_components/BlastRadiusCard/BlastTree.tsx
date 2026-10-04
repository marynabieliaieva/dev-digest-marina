/* BlastTree — downstream symbols with their callers. All repo-derived strings
   are rendered as React text nodes; hrefs only go through githubBlobUrl. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

interface BlastTreeProps {
  blast: BlastRadiusResponse["blast"];
  repoFullName: string | null;
  sha: string;
}

export function BlastTree({ blast, repoFullName, sha }: BlastTreeProps) {
  const t = useTranslations("blast");
  return (
    <div style={s.group}>
      {blast.downstream.map((d, di) => (
        <div key={`${di}-${d.symbol}`} style={s.group}>
          <div style={s.symbol}>
            {d.symbol}
            <span style={s.callerCount}>{t("callerCount", { count: d.callers.length })}</span>
          </div>
          <ul style={s.callerList}>
            {d.callers.map((c, ci) => {
              const text = `${c.file}:${c.line}`;
              return (
                <li key={`${ci}-${text}`} style={s.caller}>
                  {repoFullName ? (
                    <a
                      href={githubBlobUrl(repoFullName, sha, c.file, c.line)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {text}
                    </a>
                  ) : (
                    text
                  )}
                </li>
              );
            })}
          </ul>
          {d.endpoints_affected.length > 0 && (
            <div style={s.chips} aria-label={t("endpointsLabel")} role="group">
              {d.endpoints_affected.map((e, i) => (
                <span key={`${i}-${e}`} style={s.chip}>
                  {e}
                </span>
              ))}
            </div>
          )}
          {d.crons_affected.length > 0 && (
            <div style={s.chips} aria-label={t("cronsLabel")} role="group">
              {d.crons_affected.map((c, i) => (
                <span key={`${i}-${c}`} style={s.chip}>
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
