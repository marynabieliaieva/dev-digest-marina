/* diff-viewer — unified-diff viewer with optional inline GitHub comments and
   review findings. Public surface: the DiffViewer component, the
   DiffCommentApi / DiffFindingApi contracts (+ finding helpers). */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export type { DiffFinding, DiffFindingApi, DiffFindingSeverity } from "./findings";
export { partitionFindings } from "./findings";
