# Notes

Changed:
- server/src/modules/reviews/service.ts: ReviewService now builds `new NotificationService(container)` (cross-module call at the call site, no container getter) and, after the review is marked completed and the comment posted, calls `record('review', 'Review completed: N findings')`. Best-effort: errors are caught and logged, never failing the review.

Created: none. The notifications module, container, and adapters are unchanged (no new external integration, so no new port).
