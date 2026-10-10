import type { ContextDoc } from "@/lib/types";

export interface DocGroup {
  folder: string;
  docs: ContextDoc[];
}

/** Split a repo-relative path into its folder ("" for the repo root) and file name. */
export function splitPath(path: string): { folder: string; name: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { folder: "", name: path } : { folder: path.slice(0, i), name: path.slice(i + 1) };
}

/** Group docs by containing folder; folders and files inside them sorted alphabetically. */
export function groupByFolder(docs: ContextDoc[]): DocGroup[] {
  const map = new Map<string, ContextDoc[]>();
  for (const d of docs) {
    const { folder } = splitPath(d.path);
    map.set(folder, [...(map.get(folder) ?? []), d]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, list]) => ({
      folder,
      docs: [...list].sort((a, b) => a.path.localeCompare(b.path)),
    }));
}
