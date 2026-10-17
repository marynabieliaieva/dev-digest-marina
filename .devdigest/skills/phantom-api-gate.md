# Phantom API gate

Code that calls something which does not exist fails at run time, not at review
time, and it is the most common way generated code breaks.

For each symbol the diff CALLS but does not define — a function, method, option,
config key, env var, CLI flag, or response field it reads — check whether the diff
or the surrounding context shows it existing. When it does not:

- Report a CRITICAL if the call is on a path that always runs.
- Report a WARNING if it is on a rare or error-only path.

Be honest about uncertainty: if the symbol plausibly exists elsewhere in the repo
and you simply cannot see it, do not report it. This gate is for calls that look
invented — a plausible-sounding option that no code in view ever defines.