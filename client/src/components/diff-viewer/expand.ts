/* Imperative "expand/collapse every file" command for the DiffViewer. A new
   `nonce` re-applies `open` to every FileCard even if the value is unchanged,
   so a user's manual toggles are overridden by the next click. nonce 0 = no command yet. */
export interface DiffExpandSignal {
  open: boolean;
  nonce: number;
}
