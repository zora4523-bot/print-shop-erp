// Returns `raw` only when it's a same-origin, internal path; otherwise the
// fallback. Used to sanitize the post-login `?from` / hidden-field target so
// attackers can't pivot the login flow into an open redirect.
//
// Rejected patterns:
//   - Non-string inputs (defense-in-depth; callers should have narrowed).
//   - Empty string and anything not starting with `/`.
//   - `//…`  — protocol-relative URLs (browsers expand to the current scheme
//              + the attacker's host).
//   - `/\…`  — backslash confusion: some user-agents historically normalized
//              `\` to `/`, making `/\evil` equivalent to `//evil`.
//
// Allowed:
//   - `/`, `/a/b`, `/a?q=1`, `/a#frag`.
export function safeInternalPath(raw: unknown): string {
  const FALLBACK = '/';
  if (typeof raw !== 'string' || raw.length === 0) return FALLBACK;
  if (!raw.startsWith('/')) return FALLBACK;
  if (/^\/[/\\]/.test(raw)) return FALLBACK;
  return raw;
}
