# Notes

Changed:
- server/src/modules/reviews/service.ts: constructs `NotificationService` at the call site (`new NotificationService(container)`, per the onion-architecture cross-module rule) and, after the review is marked completed, calls `record('review', 'Review completed: N findings')`. Best-effort (errors swallowed) so a notification failure never fails the review.

Created: none. No container facade, port, or new adapter needed (single in-process caller, no new external integration).
