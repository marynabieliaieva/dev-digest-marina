# Lethal trifecta

Report a CRITICAL when a SINGLE reachable path in this diff combines all three:

1. **Private data** — secrets, credentials, user PII, internal-only records.
2. **Untrusted input** — request bodies/params, webhook payloads, PR text, file
   contents, model output, anything fetched from a URL a user supplied.
3. **An external channel** — an outbound HTTP request, an email or message, a
   write to a shared log, a rendered response to another party.

Any two of the three is a WARNING; all three is CRITICAL, because untrusted input
can then steer private data out of the system.

In the rationale, name each of the three with its file and line, and describe the
path from input to exfiltration in one sentence. Prefer the fix that removes a leg
of the triangle entirely over one that merely filters the input.