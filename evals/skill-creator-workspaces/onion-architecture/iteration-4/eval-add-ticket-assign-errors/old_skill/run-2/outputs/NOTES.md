# Notes
Changed:
- server/src/modules/tickets/service.ts: added `assign` (404 if missing, 422 if closed, GitHub via `container.issues` port, failures wrapped as ExternalServiceError 502; DB updated only after GitHub succeeds).
- server/src/modules/tickets/routes.ts: added POST /tickets/:id/assign with body schema { assignee }; delegates to one service method.
No new files elsewhere: IssueTracker port, container wiring and repository.setAssignee already existed.
