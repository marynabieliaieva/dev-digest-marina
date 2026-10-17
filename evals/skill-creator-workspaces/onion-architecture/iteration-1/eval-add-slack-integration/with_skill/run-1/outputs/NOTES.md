# Slack notification on review completion

Layering follows onion-architecture: port -> adapter -> mock -> container -> service.

Changed:
- server/src/vendor/shared/adapters.ts: added `NotificationClient` port.
- server/src/adapters/mocks.ts: added `MockNotificationClient`.
- server/src/platform/container.ts: added `notifications` override and async `notifications()` getter; reads `SLACK_WEBHOOK_URL` from the secrets provider, returns null if unset.
- server/src/modules/reviews/service.ts: after a run completes, calls `NotificationService` (best-effort, errors logged, never fails the run).

Created:
- server/src/adapters/notifications/slack.ts: webhook implementation (plain `fetch`, no SDK).
- server/src/modules/notifications/service.ts: `NotificationService.notifyReviewDone`, depends only on the Container/port.

Note: the shared contract is also duplicated to client/src/vendor/shared per repo convention, but the client does not need this port.
