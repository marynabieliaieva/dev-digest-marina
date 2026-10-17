# Notes

Teams webhook posting after digest generation, following the onion layering (port -> adapter -> mock -> container -> service).

Created:
- server/src/vendor/shared/adapters.ts  - `DigestNotifier` port (fixture had none; merge into the real file)
- server/src/adapters/teams/webhook.ts  - `TeamsWebhookNotifier`, the only code that knows the webhook protocol (uses fetch, no SDK)
- server/src/adapters/mocks.ts          - `MockDigestNotifier` test double

Changed:
- server/src/platform/container.ts      - `ContainerOverrides`, async `notifier()` getter reading `TEAMS_WEBHOOK_URL` (null if unset)
- server/src/modules/digests/service.ts - `generate` posts via the port after insert; best-effort, errors logged not thrown

Unchanged: repository.ts, no routes added (no HTTP consumer needed).
