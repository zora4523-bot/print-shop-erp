import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PRINT_FONT_FILES, printFontCss } from './print-fonts';

// Standalone setContent has no application origin. Embed the exact same font
// bytes, so rendering never depends on a CDN, cookies or installed OS fonts.
let embeddedCss: Promise<string> | undefined;
export function embeddedPrintFontCss(): Promise<string> {
  embeddedCss ??= Promise.all(PRINT_FONT_FILES.map(async (name) =>
    `data:font/woff2;base64,${(await readFile(join(process.cwd(), 'public/fonts/print', name))).toString('base64')}`,
  )).then(printFontCss).catch((error: unknown) => {
    embeddedCss = undefined;
    throw error;
  });
  return embeddedCss;
}
