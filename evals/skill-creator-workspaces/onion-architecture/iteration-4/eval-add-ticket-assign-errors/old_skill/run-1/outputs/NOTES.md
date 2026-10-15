# Notes

Changed:
- server/src/modules/tickets/routes.ts - added POST /tickets/:id/assign (validates body, calls one service method).
- server/src/modules/tickets/service.ts - added assign(): 404 if missing, 409 if closed, GitHub assign via container.issues port (failure -> ExternalServiceError 502), then persists via repository.
- server/src/platform/errors.ts - added ConflictError (409).

No new files besides NOTES.md. Existing IssueTracker port, adapter, container and repository.setAssignee were reused unchanged.
