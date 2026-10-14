# Notes

Created:
- server/src/adapters/slack/webhook.ts - SlackWebhookNotifier; reads SLACK_WEBHOOK_URL from the SecretsProvider, POSTs a short message; no-op if the secret is unset.

Changed:
- server/src/vendor/shared/adapters.ts - added `Notifier` port and `ReviewNotification` type.
- server/src/adapters/mocks.ts - added `MockNotifier`.
- server/src/platform/container.ts - added `notifier` getter/override.
- server/src/modules/reviews/service.ts - calls `container.notifier` after the review completes (errors logged, not thrown).
