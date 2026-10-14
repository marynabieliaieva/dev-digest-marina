# Notes

Created:
- server/src/modules/digests/ports.ts (DigestNotifier port)
- server/src/platform/teams-notifier.ts (Teams webhook adapter + Noop)

Changed:
- server/src/platform/container.ts (digestNotifier; createContainer reads TEAMS_WEBHOOK_URL)
- server/src/modules/digests/service.ts (notify after insert, best-effort)

Callers should construct the container via createContainer(db). Unset TEAMS_WEBHOOK_URL means no-op.
