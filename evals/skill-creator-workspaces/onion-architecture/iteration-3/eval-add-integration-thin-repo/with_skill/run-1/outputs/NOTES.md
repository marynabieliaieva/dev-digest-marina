# Notes

Teams webhook posting after digest generation, via a port (onion architecture).

Created:
- server/src/vendor/shared/adapters.ts - `DigestNotifier` port (in the real repo, add to the existing file)
- server/src/adapters/teams/teams-notifier.ts - `TeamsDigestNotifier`, the only code that knows the webhook format
- server/src/adapters/mocks.ts - `MockDigestNotifier` for tests

Changed:
- server/src/platform/container.ts - `ContainerOverrides`, async `digestNotifier()` getter; reads TEAMS_WEBHOOK_URL (null if unset)
- server/src/modules/digests/service.ts - `generate()` posts via the port after insert, best-effort (errors logged, not thrown)

Unchanged: repository.ts. No routes added.
