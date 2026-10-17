# Secret leakage gate

A credential-shaped literal ADDED by this diff is always CRITICAL, even in a test,
fixture, example or comment — committed secrets must be rotated regardless of where
they sit, so the finding is about the commit, not the call site.

Patterns to treat as credentials:
- `sk_live_` / `sk_test_` / `pk_live_` (Stripe), `AKIA[0-9A-Z]{16}` (AWS),
  `AIza[0-9A-Za-z_-]{35}` (Google), `gh[ps]_[A-Za-z0-9]{36,}` (GitHub),
  `xox[bpsa]-` (Slack), `npm_[A-Za-z0-9]{36}`.
- `-----BEGIN ... PRIVATE KEY-----`.
- A connection string with inline credentials: `postgres://user:pass@host`.
- Any assignment to a name containing `secret`, `token`, `password` or `apikey`
  whose right-hand side is a string literal of 8+ characters.

In the suggestion, always say BOTH steps: move it to configuration AND rotate the
exposed credential. Never quote the full secret back in the finding — cite the line.