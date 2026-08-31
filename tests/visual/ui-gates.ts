import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';

export async function expectViewportGate(page: Page, testInfo: TestInfo) {
  const mobile = testInfo.project.use.viewport?.width
    ? testInfo.project.use.viewport.width <= 768
    : false;
  const failures = await page.evaluate(({ mobile }) => {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const issues: string[] = [];
    const describe = (element: HTMLElement) => {
      const id = element.id ? `#${element.id}` : '';
      const slot = element.dataset.slot ? `[data-slot=${element.dataset.slot}]` : '';
      const classes = [...element.classList].slice(0, 3).join('.');
      return `${element.tagName.toLowerCase()}${id}${slot}${classes ? `.${classes}` : ''}`;
    };
    const isVisible = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const isContainedByHorizontalScroller = (element: HTMLElement) => {
      let parent = element.parentElement;
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        const scrolls = style.overflowX === 'auto' || style.overflowX === 'scroll';
        if (scrolls && parent.scrollWidth > parent.clientWidth + 1) {
          const rect = parent.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= viewportWidth + 1;
        }
        parent = parent.parentElement;
      }
      return false;
    };

    const elements = [
      ...document.querySelectorAll<HTMLElement>('body *'),
    ].filter(isVisible);
    if (document.documentElement.scrollWidth > viewportWidth + 1) {
      const candidates = elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            element,
            right: Math.max(rect.right, rect.left + element.scrollWidth),
          };
        })
        .filter(({ right }) => right > viewportWidth + 1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 3)
        .map(
          ({ element, right }) =>
            `${describe(element)}@${right.toFixed(1)}`,
        )
        .join(',');
      issues.push(
        `root-horizontal-overflow:${document.documentElement.scrollWidth}>${viewportWidth}${candidates ? `:${candidates}` : ''}`,
      );
    }

    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        (rect.right > viewportWidth + 1 || rect.left < -1) &&
        !isContainedByHorizontalScroller(element)
      ) {
        issues.push(
          `viewport-x:${describe(element)}:[${rect.left.toFixed(1)},${rect.right.toFixed(1)}]/${viewportWidth}`,
        );
      }
      if (
        (style.position === 'fixed' ||
          (style.position === 'sticky' &&
            (style.top !== 'auto' || style.bottom !== 'auto'))) &&
        rect.top < viewportHeight &&
        rect.bottom > viewportHeight + 1
      ) {
        issues.push(
          `viewport-y:${describe(element)}:${rect.bottom.toFixed(1)}>${viewportHeight}`,
        );
      }

      const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      const clipped =
        (clipsX && element.scrollWidth > element.clientWidth + 1) ||
        (clipsY && element.scrollHeight > element.clientHeight + 1);
      const hasAccessibleFullText = Boolean(
        element.classList.contains('sr-only') ||
          element.title ||
          element.getAttribute('aria-label') ||
          element.getAttribute('aria-describedby'),
      );
      if (clipped && element.textContent?.trim() && !hasAccessibleFullText) {
        issues.push(
          `hidden-clipping:${describe(element)}:${element.scrollWidth}x${element.scrollHeight}>${element.clientWidth}x${element.clientHeight}`,
        );
      }
    }

    const nativeCheckboxes = [
      ...document.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]:not([aria-hidden="true"])',
      ),
    ].filter(isVisible);
    for (const checkbox of nativeCheckboxes) {
      issues.push(`native-checkbox:${describe(checkbox)}`);
    }

    const sharedCheckboxes = [
      ...document.querySelectorAll<HTMLElement>('[data-slot="checkbox"]'),
    ].filter(isVisible);
    for (const checkbox of sharedCheckboxes) {
      const targetRect = checkbox.getBoundingClientRect();
      const indicator = checkbox.querySelector<HTMLElement>(
        '[data-slot="checkbox-indicator"]',
      );
      const indicatorRect = indicator?.getBoundingClientRect();
      if (targetRect.width < 44 || targetRect.height < 44) {
        issues.push(
          `checkbox-target:${describe(checkbox)}:${targetRect.width.toFixed(1)}x${targetRect.height.toFixed(1)}`,
        );
      }
      if (
        !indicatorRect ||
        indicatorRect.width < 18 ||
        indicatorRect.width > 22 ||
        indicatorRect.height < 18 ||
        indicatorRect.height > 22
      ) {
        issues.push(
          `checkbox-indicator:${describe(checkbox)}:${indicatorRect ? `${indicatorRect.width.toFixed(1)}x${indicatorRect.height.toFixed(1)}` : 'missing'}`,
        );
      }
    }

    if (mobile) {
      const interactives = [
        ...document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([type="hidden"]):not([aria-hidden="true"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"]:not([aria-disabled="true"]), [role="checkbox"]:not([aria-disabled="true"])',
        ),
      ].filter(isVisible);
      for (const element of interactives) {
        const rect = element.getBoundingClientRect();
        if (rect.width < 44 || rect.height < 44) {
          issues.push(
            `touch-target:${describe(element)}:${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`,
          );
        }
      }
    }

    return [...new Set(issues)];
  }, { mobile });

  expect(failures, failures.join('\n')).toEqual([]);
}

export async function expectA11yGate(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const failures = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => ({
      selector: node.target.join(' '),
      html: node.html,
      summary: node.failureSummary,
    })),
  }));
  expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
}

export async function attachCandidateScreenshot(
  page: Page,
  testInfo: TestInfo,
  suite: string,
  name: string,
) {
  const screenshotPath = path.join(
    process.cwd(),
    'test-results',
    `${suite}-ui-baseline-candidates`,
    testInfo.project.name,
    `${name}.png`,
  );
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    animations: 'disabled',
    style: 'nextjs-portal { display: none !important; }',
  });
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' });
}
