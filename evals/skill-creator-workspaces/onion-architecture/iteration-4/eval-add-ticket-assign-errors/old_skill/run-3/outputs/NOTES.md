# Notes

Changed:
- server/src/modules/tickets/service.ts - added `assign(id, assignee)`: 404 if missing, ValidationError (422) if closed, calls the `IssueTracker` port via `container.issues` (GitHub first, errors wrapped in ExternalServiceError -> 502), then persists via `repo.setAssignee`.
- server/src/modules/tickets/routes.ts - added `POST /tickets/:id/assign` (body schema `{ assignee }`), one service call, no business logic.

No new files; existing port (`IssueTracker`), adapter and container wiring were reused, so no SDK import was added outside the adapter.
