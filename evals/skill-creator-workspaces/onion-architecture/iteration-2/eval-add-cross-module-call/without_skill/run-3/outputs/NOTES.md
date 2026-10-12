# Notes

Changed:
- server/src/modules/reviews/service.ts: after a review completes, calls the existing
  NotificationService.record('review', 'Review finished: N findings') (injectable, defaults to new NotificationService(container)).

Created: none besides this file.
