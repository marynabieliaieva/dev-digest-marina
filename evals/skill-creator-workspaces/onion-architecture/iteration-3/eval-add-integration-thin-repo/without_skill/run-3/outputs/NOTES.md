# Notes

Created:
- server/src/modules/digests/ports.ts (DigestNotifier port)
- server/src/platform/teams-webhook-notifier.ts (Teams adapter using fetch + no-op fallback)

Changed:
- server/src/platform/container.ts (builds notifier from TEAMS_WEBHOOK_URL)
- server/src/modules/digests/service.ts (notifies after insert; failures are logged, not thrown)
