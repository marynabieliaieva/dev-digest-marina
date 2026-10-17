# Notes

Teams webhook posting follows the onion layering: port -> adapter -> mock -> container -> service. The service never touches the webhook or `fetch`.

Created:
- server/src/vendor/shared/adapters.ts (new `DigestNotifier` port; re-export from the shared barrel)
- server/src/adapters/teams/teams-notifier.ts (concrete Teams webhook adapter using fetch)
- server/src/adapters/mocks.ts (`MockDigestNotifier`)

Changed:
- server/src/platform/container.ts (`ContainerOverrides`, `digestNotifier()` getter reading TEAMS_WEBHOOK_URL; returns null if unset)
- server/src/modules/digests/service.ts (`generate` posts best-effort after insert; failures are logged, not thrown)
