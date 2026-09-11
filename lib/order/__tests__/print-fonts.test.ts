import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { printFontCss, requirePrintFonts } from '../print-fonts';
import manifest from '../../../public/fonts/print/manifest.json';

describe('portable print fonts', () => {
  it('ships the reviewed, licensed font bytes without remote font dependencies', async () => {
    for (const item of manifest) {
      const bytes = await readFile(`public/fonts/print/${item.file}`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.sha256);
      expect(bytes.subarray(0, 4).toString()).toBe('wOF2');
    }
    expect(printFontCss()).not.toMatch(/https?:|local\(/);
    expect(await readFile('public/fonts/print/OFL.txt', 'utf8')).toContain('SIL OPEN FONT LICENSE');
  });
  it('does not accept system fallback when a declared font failed to load', async () => {
    const dataset: Record<string, string> = {};
    const document = { documentElement: { dataset }, querySelector: () => ({}), fonts: { load: vi.fn().mockResolvedValue([]) } } as unknown as Document;
    await expect(requirePrintFonts(document)).rejects.toThrow('PRINT_FONT_UNAVAILABLE');
    expect(dataset).toMatchObject({ printFonts: 'failed', printPagination: 'font-error' });
  });
  it('bounds font network hangs', async () => {
    vi.useFakeTimers();
    try {
      const dataset: Record<string, string> = {};
      const document = { documentElement: { dataset }, querySelector: () => ({}), fonts: { load: () => new Promise(() => {}) } } as unknown as Document;
      const result = expect(requirePrintFonts(document)).rejects.toThrow('PRINT_FONT_TIMEOUT');
      await vi.advanceTimersByTimeAsync(8000);
      await result;
      expect(dataset.printFonts).toBe('failed');
    } finally { vi.useRealTimers(); }
  });
});
