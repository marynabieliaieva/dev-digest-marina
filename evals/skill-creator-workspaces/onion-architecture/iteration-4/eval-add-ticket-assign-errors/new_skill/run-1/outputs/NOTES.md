# Notes

Changed:
- server/src/modules/tickets/routes.ts: added POST /tickets/:id/assign (parses, calls one service method).
- server/src/modules/tickets/service.ts: added assign(): validates assignee (422), 404 if missing, 422 if closed, assigns on GitHub via container.issues (port) first, then DB via repository.
- server/src/adapters/github/issues.ts: Octokit failures now wrapped in ExternalServiceError (502) so GitHub errors surface to the caller; no vendor exception leaks.

Created: none. Port (IssueTracker), container wiring, repository.setAssignee and error classes already existed.
Order: GitHub before DB so a GitHub failure leaves the DB unchanged.
