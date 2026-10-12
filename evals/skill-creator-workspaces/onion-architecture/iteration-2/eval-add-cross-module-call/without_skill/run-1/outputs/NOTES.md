# Notes

Changed:
- server/src/modules/reviews/service.ts: ReviewService now builds a NotificationService (from the existing notifications module) and, after the review is marked completed and the comment posted, calls `record('review', 'Review completed: N finding(s)')`.

Created: none other.
