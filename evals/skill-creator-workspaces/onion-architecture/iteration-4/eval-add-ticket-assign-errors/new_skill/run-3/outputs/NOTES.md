# Notes

Changed (all under server/src):
- modules/tickets/routes.ts: added POST /tickets/:id/assign; parses body with zod, calls one service method, throws no hand-built errors.
- modules/tickets/service.ts: added assign(): 404 via NotFoundError, closed ticket rejected via ValidationError (422), GitHub assign via container.issues port first, then DB update (so a GitHub failure leaves DB unchanged).
- adapters/github/issues.ts: assign() wraps Octokit failures in ExternalServiceError (502), surfaced by the central error handler.

Assumption: closed status value is the string 'closed'. No new files; repository.ts, container.ts, port unchanged.
