import { describe, expect, it, vi } from 'vitest';
import {
  formatArtworkFailureWarning,
  preparePrintDocument,
  PRINT_READY_EVENT,
  PRINT_READY_TIMEOUT_MS,
  waitForPrintReady,
} from '../AutoPrint';

function preparationHarness(options: { imageFails?: boolean } = {}) {
  const documentEvents = new EventTarget();
  const windowEvents = new EventTarget();
  const documentElement = { dataset: {} as DOMStringMap };
  const warning = { hidden: true, textContent: '' };
  const failedClasses: string[] = [];
  const thumb = {
    dataset: { fig: '7' },
    classList: { add: (value: string) => failedClasses.push(value) },
  };
  const image = Object.assign(new EventTarget(), {
    complete: true,
    naturalWidth: options.imageFails ? 0 : 100,
    closest: () => thumb,
  });
  const documentTarget = {
    documentElement,
    fonts: { ready: Promise.resolve() },
    querySelectorAll(selector: string) {
      if (selector === 'img[data-print-artwork="true"]') return [image];
      if (selector === '.image-load-warning') return [warning];
      return [];
    },
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener:
      documentEvents.removeEventListener.bind(documentEvents),
    dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents),
  } as unknown as Document;
  const windowTarget = {
    setTimeout,
    clearTimeout,
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
  } as unknown as Window;
  return {
    documentTarget,
    windowTarget,
    documentElement,
    warning,
    failedClasses,
    documentEvents,
    windowEvents,
  };
}

function readinessHarness(initiallyReady = false) {
  const documentEvents = new EventTarget();
  const windowEvents = new EventTarget();
  const timers = new Map<number, () => void>();
  let nextTimer = 1;

  const documentTarget = {
    documentElement: {
      dataset: initiallyReady ? { printReady: 'true' } : {},
    },
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener:
      documentEvents.removeEventListener.bind(documentEvents),
  } as unknown as Parameters<typeof waitForPrintReady>[0];

  const windowTarget = {
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    setTimeout(callback: TimerHandler) {
      const id = nextTimer++;
      timers.set(id, callback as () => void);
      return id;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
  } as unknown as Parameters<typeof waitForPrintReady>[1];

  return {
    documentTarget,
    windowTarget,
    timers,
    dispatchDocumentReady: () =>
      documentEvents.dispatchEvent(new Event(PRINT_READY_EVENT)),
    dispatchWindowReady: () =>
      windowEvents.dispatchEvent(new Event(PRINT_READY_EVENT)),
  };
}

describe('waitForPrintReady', () => {
  it('prints once when the document is already ready', () => {
    const harness = readinessHarness(true);
    const onReady = vi.fn();

    waitForPrintReady(
      harness.documentTarget,
      harness.windowTarget,
      onReady,
    );

    expect(harness.timers.size).toBe(2);
    harness.timers.get(2)?.();
    harness.dispatchDocumentReady();
    harness.dispatchWindowReady();

    expect(onReady).toHaveBeenCalledOnce();
    expect(harness.timers.size).toBe(0);
  });

  it('accepts either readiness event and ignores duplicates', () => {
    const harness = readinessHarness();
    const onReady = vi.fn();

    waitForPrintReady(
      harness.documentTarget,
      harness.windowTarget,
      onReady,
    );
    harness.dispatchWindowReady();
    harness.dispatchDocumentReady();

    expect(onReady).toHaveBeenCalledOnce();
    expect(harness.timers.size).toBe(0);
  });

  it('falls back after twelve seconds instead of hanging', () => {
    const harness = readinessHarness();
    const onReady = vi.fn();

    waitForPrintReady(
      harness.documentTarget,
      harness.windowTarget,
      onReady,
    );

    expect(harness.timers.size).toBe(1);
    harness.timers.get(1)?.();

    expect(onReady).toHaveBeenCalledOnce();
    expect(PRINT_READY_TIMEOUT_MS).toBe(12_000);
    expect(harness.timers.size).toBe(0);
  });
});

describe('preparePrintDocument', () => {
  it('marks a client-navigated print page ready after its assets settle', async () => {
    const harness = preparationHarness();
    const documentReady = vi.fn();
    const windowReady = vi.fn();
    harness.documentEvents.addEventListener(PRINT_READY_EVENT, documentReady);
    harness.windowEvents.addEventListener(PRINT_READY_EVENT, windowReady);

    preparePrintDocument(harness.documentTarget, harness.windowTarget);

    await vi.waitFor(() => {
      expect(harness.documentElement.dataset.printReady).toBe('true');
    });
    expect(documentReady).toHaveBeenCalledOnce();
    expect(windowReady).toHaveBeenCalledOnce();
  });

  it('keeps a failed image box and exposes the affected figure in the audit warning', async () => {
    const harness = preparationHarness({ imageFails: true });

    preparePrintDocument(harness.documentTarget, harness.windowTarget);

    await vi.waitFor(() => {
      expect(harness.warning.hidden).toBe(false);
    });
    expect(harness.failedClasses).toContain('image-failed');
    expect(harness.warning.textContent).toBe('设计图加载失败：图 7');
    expect(harness.documentElement.dataset.printReady).toBe('true');
  });

  it('长失败列表只展示前六个图号，避免动态告警撑破主页', () => {
    expect(
      formatArtworkFailureWarning([
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
      ]),
    ).toBe('设计图加载失败：图 1、2、3、4、5、6 等，共 8 款');
  });
});
