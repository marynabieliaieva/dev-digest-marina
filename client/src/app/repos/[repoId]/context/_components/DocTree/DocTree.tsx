/* DocTree — read-only list of context docs grouped by folder. */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import type { ContextDoc } from "@/lib/types";
import { groupByFolder, splitPath } from "./helpers";
import { s } from "./styles";

export function DocTree({
  docs,
  selected,
  onSelect,
}: {
  docs: ContextDoc[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const groups = React.useMemo(() => groupByFolder(docs), [docs]);
  return (
    <nav>
      {groups.map((g) => (
        <div key={g.folder}>
          {g.folder && (
            <div className="mono" style={s.folder} title={g.folder}>
              {g.folder}
            </div>
          )}
          {g.docs.map((d) => (
            <button
              key={d.path}
              type="button"
              className="mono"
              title={d.path}
              aria-current={d.path === selected ? "true" : undefined}
              style={s.item(d.path === selected)}
              onClick={() => onSelect(d.path)}
            >
              <Icon.FileText size={14} />
              <span style={s.name}>{splitPath(d.path).name}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
