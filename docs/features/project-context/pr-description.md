Project Context — functionality

Project Context page

* Browse the repo's Markdown documents (`specs/`, `docs/`, `insights/`) in a folder tree
* Read any document rendered, read-only
* Each document shows its type, size in tokens, and how many agents use it
* Refresh to rescan the repo

Agent and skill Context tab

* Attach documents with a checkbox, search by path, preview, drag to reorder
* See how many tokens the attached documents add to every prompt
* An agent also inherits documents from its enabled skills (shown read-only)
* Documents over 64 KB are flagged and will be skipped

Review run

* Attached documents are added to the prompt as untrusted `## Project context`
* Missing, too large (over 64 KB), unreadable, or over the 20,000-token budget — skipped, the run never fails
* No attached documents — the prompt is unchanged
* No extra LLM call

Run trace

* Shows which documents were read, their size, and why others were skipped
* Shows the full injected text

Rules

* Only file paths are stored, not the text
* Attaching documents does not create a new agent or skill version
* Not included: editing documents, automatic selection by PR content, CI runs
