# Notes

Changed:
- server/src/modules/reviews/service.ts: after the review is marked completed and the comment posted, calls the existing NotificationService.record('review', `Review finished: N findings`).

No other files created or changed.
