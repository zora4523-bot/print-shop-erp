/** Shared by the browser preview and the standalone PDF document. */
export const PRINT_FONT_FILES = ['NotoSansSC-VF.woff2', 'NotoSansMono-VF.woff2'] as const;

export function printFontCss(sources: readonly string[] = PRINT_FONT_FILES.map(
  (name) => `/fonts/print/${name}`,
)): string {
  return ['ERP Print Sans', 'ERP Print Mono'].map((family, index) =>
    `@font-face{font-family:"${family}";src:url("${sources[index]}") format("woff2");font-weight:100 900;font-style:normal;font-display:block;}`,
  ).join('\n');
}

// Keep self-contained: the standalone HTML embeds this exact function.
export async function requirePrintFonts(documentTarget: Document): Promise<void> {
  if (!documentTarget.querySelector('[data-print-fonts="required"]')) return;
  const root = documentTarget.documentElement;
  root.dataset.printFonts = 'loading';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!documentTarget.fonts) throw new Error('PRINT_FONT_UNAVAILABLE');
    const loads = [400, 600, 700, 800, 900].map(async (weight) => {
      const faces = await documentTarget.fonts.load(`${weight} 12px "ERP Print Sans"`, '工单中文 ABC 0123456789');
      if (!faces.length || faces.some((face) => face.status !== 'loaded')) throw new Error('PRINT_FONT_UNAVAILABLE');
    });
    loads.push((async () => {
      const faces = await documentTarget.fonts.load('700 12px "ERP Print Mono"', 'GD-0123456789');
      if (!faces.length || faces.some((face) => face.status !== 'loaded')) throw new Error('PRINT_FONT_UNAVAILABLE');
    })());
    await Promise.race([
      Promise.all(loads),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('PRINT_FONT_TIMEOUT')), 8000);
      }),
    ]);
    root.dataset.printFonts = 'ready';
  } catch (error) {
    root.dataset.printFonts = 'failed';
    root.dataset.printPagination = 'font-error';
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
