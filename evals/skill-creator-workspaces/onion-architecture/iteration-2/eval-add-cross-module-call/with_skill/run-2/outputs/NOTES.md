# Notes

Changed:
- server/src/modules/reviews/service.ts — after a review completes, calls NotificationService.record('review', 'Review finished: N findings'). The callee is constructed at the call site with `new NotificationService(container)` (no container getter needed for a single caller), and the call is best-effort (errors swallowed).

Created: none. The notifications module, container and adapters were left untouched.
