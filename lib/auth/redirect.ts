// Returns `raw` only when it's a same-origin, internal path; otherwise the
// fallback. Used to sanitize the post-login `?from` / hidden-field target so
// attackers can't pivot the login flow into an open redirect.
//
// Rejected patterns:
//   - Non-string inputs (defense-in-depth; callers should have narrowed).
//   - Empty string and anything not starting with `/`.
//   - Any ASCII control char (U+0000–U+001F, U+007F). Browsers strip tab /
//     LF / CR anywhere in a URL before resolving it (WHATWG URL basic
//     parser), so `/\t/evil` in a Location header becomes `//evil`.
//   - Any backslash: user-agents normalize `\` to `/` for http(s), making
//     `/\evil` equivalent to `//evil`.
//   - `//…`  — protocol-relative URLs (browsers expand to the current scheme
//              + the attacker's host).
//   - Anything that, once resolved against an internal base, leaves this
//     origin or collapses to a protocol-relative path (`/..//evil`).
//
// Allowed (returned verbatim so non-ASCII paths are not re-encoded):
//   - `/`, `/a/b`, `/a?q=1`, `/a#frag`, `/unicode/路径`.
const FALLBACK = '/';
const INTERNAL_BASE = 'http://internal.invalid';
const UNSAFE_CHAR = /[\u0000-\u001F\u007F\\]/;

export function safeInternalPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return FALLBACK;
  if (UNSAFE_CHAR.test(raw)) return FALLBACK;
  if (!raw.startsWith('/') || raw.startsWith('//')) return FALLBACK;
  return resolvesInternally(raw) ? raw : FALLBACK;
}

// `path` is already known to start with a single `/` (path-absolute), so the
// WHATWG parser never enters the authority state and cannot throw here.
function resolvesInternally(path: string): boolean {
  const resolved = new URL(path, INTERNAL_BASE);
  return resolved.origin === INTERNAL_BASE && !resolved.pathname.startsWith('//');
}
