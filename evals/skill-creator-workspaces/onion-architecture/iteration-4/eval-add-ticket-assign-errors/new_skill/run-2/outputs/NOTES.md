# Notes

Changed:
- server/src/modules/tickets/routes.ts - added POST /tickets/:id/assign (parses, calls one service method; no hand-built error bodies).
- server/src/modules/tickets/service.ts - added assign(): validates assignee (ValidationError), NotFoundError if missing, ValidationError if closed, calls container.issues.assign (GitHub) before repo.setAssignee (DB).
- server/src/adapters/github/issues.ts - assign() wraps Octokit failures in ExternalServiceError (502).

Unchanged: repository.ts (setAssignee already existed), container.ts and IssueTracker port (already had assign).
