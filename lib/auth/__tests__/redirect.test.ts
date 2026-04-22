import { describe, it, expect } from 'vitest';
import { safeInternalPath } from '../redirect';

describe('safeInternalPath', () => {
  describe('keeps legitimate internal paths', () => {
    it.each([
      ['/', '/'],
      ['/owner', '/owner'],
      ['/owner/accounts', '/owner/accounts'],
      ['/a?b=c', '/a?b=c'],
      ['/x#frag', '/x#frag'],
      ['/a/b/c?q=1&r=2#section', '/a/b/c?q=1&r=2#section'],
      ['/unicode/路径', '/unicode/路径'],
    ])('%j → %j', (input, expected) => {
      expect(safeInternalPath(input)).toBe(expected);
    });
  });

  describe('rejects open-redirect vectors (Codex round 8)', () => {
    it.each([
      // Protocol-relative — the attack Codex round 8 flagged.
      ['//evil.example'],
      ['//evil.example/path'],
      ['//evil.example/path?q=1'],
      ['///tripled'],
      ['//////many'],
      // Backslash confusion.
      ['/\\evil.example'],
      ['/\\/evil.example'],
      ['/\\\\evil.example'],
      // URL-encoded double-slash survives decoding by the framework, so we
      // also guard the post-decode value here.
      ['//\u202Eevil'],
    ])('%j → /', (input) => {
      expect(safeInternalPath(input)).toBe('/');
    });
  });

  describe('rejects non-internal or non-string inputs', () => {
    it.each([
      '',
      'relative',
      'foo/bar',
      'https://evil.example',
      'http://evil.example/path',
      'javascript:alert(1)',
      'data:text/html,<script>',
      'mailto:x@y.z',
    ])('string %j → /', (input) => {
      expect(safeInternalPath(input)).toBe('/');
    });

    it.each([undefined, null, 42, true, { pathname: '/ok' }, ['/ok']])(
      'non-string %j → /',
      (input) => {
        expect(safeInternalPath(input)).toBe('/');
      },
    );
  });
});
