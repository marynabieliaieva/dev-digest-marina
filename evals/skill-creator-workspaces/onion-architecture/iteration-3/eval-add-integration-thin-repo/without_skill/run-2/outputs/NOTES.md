# Notes

Created:
- server/src/modules/digests/ports.ts (DigestNotifier port)
- server/src/platform/teams-notifier.ts (Teams webhook adapter; reads TEAMS_WEBHOOK_URL)

Changed:
- server/src/platform/container.ts (exposes digestNotifier, built from env; null if unset)
- server/src/modules/digests/service.ts (notifies after insert; errors logged, not thrown)
