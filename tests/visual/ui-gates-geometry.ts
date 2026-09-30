// Deterministic geometry rules promoted from the 2026-09-29 UI review probe
// (docs/audits/2026-09-29-ui-review.md §1 L3). Runs inside the page via
// page.evaluate, so it must stay self-contained: no imports, no closures over
// module scope. The style census from the probe is deliberately NOT here — it
// is a review tool, not an assertion.
export function collectGeometryIssues(): string[] {
  const issues: string[] = [];
  const isVisible = (el: Element) => {
    if (!(el as HTMLElement).checkVisibility?.({ visibilityProperty: true, opacityProperty: true })) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const describe = (el: Element) => {
    const h = el as HTMLElement;
    const id = h.id ? `#${h.id}` : '';
    const slot = h.dataset?.slot ? `[data-slot=${h.dataset.slot}]` : '';
    const classes = [...h.classList].slice(0, 3).join('.');
    const label = (h.getAttribute('aria-label') || h.innerText || (h as HTMLInputElement).value || h.getAttribute('placeholder') || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 20);
    return `${h.tagName.toLowerCase()}${id}${slot}${classes ? `.${classes}` : ''}${label ? `「${label}」` : ''}`;
  };
  const f = (n: number) => n.toFixed(1);
  const centerY = (r: DOMRect) => r.top + r.height / 2;
  const centerX = (r: DOMRect) => r.left + r.width / 2;

  // ---- 1. same-row control alignment ---------------------------------------
  const CONTROL_SELECTOR = [
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([aria-hidden=true])',
    'select',
    'button',
    '[role=combobox]',
    'a[data-slot=button]',
  ].join(',');
  // Image thumbnails that open a preview are media, not form controls; their
  // height follows the picture, so they never share a control row height.
  const isMediaTrigger = (el: HTMLElement) =>
    Boolean(el.querySelector('img, picture, video')) && !el.innerText.trim();
  const controls = [...document.body.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)].filter(
    (el) =>
      !el.matches('[role=tab]') &&
      !el.closest('[data-slot=checkbox]') &&
      isVisible(el) &&
      !isMediaTrigger(el),
  );
  const isRowLayout = (el: Element) => {
    const style = getComputedStyle(el);
    return (
      (style.display.includes('flex') && !style.flexDirection.startsWith('column')) ||
      style.display.includes('grid')
    );
  };
  // Each control belongs to one row: its nearest flex/grid ancestor (within 4
  // levels) that also holds another control. A control already paired in an
  // inner row is not compared again against unrelated cells of an outer grid.
  const rowOf = new Map<Element, HTMLElement[]>();
  for (const control of controls) {
    let parent = control.parentElement;
    for (let depth = 0; parent && parent !== document.body && depth < 4; depth++, parent = parent.parentElement) {
      if (!isRowLayout(parent)) continue;
      const container = parent;
      if (!controls.some((c) => c !== control && container.contains(c))) continue;
      if (!rowOf.has(container)) rowOf.set(container, []);
      rowOf.get(container)!.push(control);
      break;
    }
  }
  for (const [container, members] of rowOf) {
    if (members.length < 2 || members.length > 12) continue;
    // Cluster by vertical overlap so wrapped rows are compared separately.
    const rects = members
      .map((c) => ({ c, r: c.getBoundingClientRect() }))
      .sort((a, b) => a.r.top - b.r.top);
    const rows: (typeof rects)[] = [];
    for (const item of rects) {
      const row = rows.find((candidate) =>
        candidate.some(
          (o) =>
            Math.min(o.r.bottom, item.r.bottom) - Math.max(o.r.top, item.r.top) >
            Math.min(o.r.height, item.r.height) * 0.4,
        ),
      );
      if (row) row.push(item);
      else rows.push([item]);
    }
    for (const row of rows) {
      if (row.length < 2) continue;
      // 同一对齐行只看底边：等高但上下错开同样是错位（Codex 2026-09-29 指出
      // 旧的「高度差且底边差」会漏掉等高错位，而共享控件恰恰普遍等高）。
      const bottoms = row.map((x) => x.r.bottom);
      const db = Math.max(...bottoms) - Math.min(...bottoms);
      if (db > 2) {
        issues.push(
          `row-misaligned:${describe(container).replace(/「.*」$/, '')}:${row
            .map((x) => `${describe(x.c)}h${f(x.r.height)}b${f(x.r.bottom)}`)
            .join('|')}`,
        );
      }
    }
  }

  // ---- 2. checkbox indicator ↔ label text ----------------------------------
  const acceptText = (checkbox: Element) => (node: Node) => {
    const parentEl = node.parentElement;
    if (!node.textContent?.trim() || !parentEl || checkbox.contains(node)) return NodeFilter.FILTER_REJECT;
    if (parentEl.closest('.sr-only') || !isVisible(parentEl)) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  };
  for (const checkbox of document.querySelectorAll<HTMLElement>('[data-slot=checkbox]')) {
    if (!isVisible(checkbox)) continue;
    const indicator = checkbox.querySelector('[data-slot=checkbox-indicator]') ?? checkbox;
    const ir = indicator.getBoundingClientRect();
    const labelledBy = checkbox.getAttribute('aria-labelledby')?.split(/\s+/)[0];
    const host =
      checkbox.closest('label') ??
      (checkbox.id ? document.querySelector(`label[for="${CSS.escape(checkbox.id)}"]`) : null) ??
      (labelledBy ? document.getElementById(labelledBy) : null) ??
      checkbox.parentElement;
    if (!host) continue;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, { acceptNode: acceptText(checkbox) });
    // Only text after the checkbox is its adjacent label.
    let textNode: Node | null = walker.nextNode();
    while (textNode && host.contains(checkbox) && checkbox.compareDocumentPosition(textNode) & Node.DOCUMENT_POSITION_PRECEDING) {
      textNode = walker.nextNode();
    }
    if (!textNode) continue;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const line = range.getClientRects()[0];
    if (!line) continue;
    const dy = centerY(ir) - (line.top + line.height / 2);
    const gap = line.left - ir.right;
    const where = `${describe(checkbox.parentElement ?? checkbox).replace(/「.*」$/, '')}「${textNode.textContent!.trim().slice(0, 20)}」`;
    if (Math.abs(dy) > 3) issues.push(`checkbox-offset:${where}:dy${f(dy)}`);
    if (gap < 2 || gap > 20) issues.push(`checkbox-gap:${where}:gap${f(gap)}`);
  }

  // ---- 3. icon inside input -------------------------------------------------
  const fields = [...document.querySelectorAll<HTMLElement>(
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file])',
  )].filter(isVisible);
  for (const field of fields) {
    const fr = field.getBoundingClientRect();
    const wrapper = field.parentElement;
    if (!wrapper) continue;
    for (const icon of wrapper.querySelectorAll('svg')) {
      if (field.contains(icon) || !isVisible(icon)) continue;
      const positioned = getComputedStyle(icon).position === 'absolute' ||
        (icon.parentElement !== wrapper && getComputedStyle(icon.parentElement!).position === 'absolute');
      if (!positioned) continue;
      const r = icon.getBoundingClientRect();
      const insideX = r.left >= fr.left - 1 && r.right <= fr.right + 1;
      const insideY = r.top >= fr.top - 1 && r.bottom <= fr.bottom + 1;
      if (!insideX || !insideY) continue;
      const dy = centerY(r) - centerY(fr);
      if (Math.abs(dy) > 2) issues.push(`icon-offset:${describe(field)}:dy${f(dy)}`);
    }
  }

  // ---- 4. select-all column alignment --------------------------------------
  const allCheckboxes = [...document.querySelectorAll<HTMLElement>('[role=checkbox]')].filter(isVisible);
  const indicatorOf = (el: Element) => (el.querySelector('[data-slot=checkbox-indicator]') ?? el).getBoundingClientRect();
  for (const header of allCheckboxes) {
    const name = header.getAttribute('aria-label') ?? '';
    const isHeader = name.includes('选择本页') || Boolean(header.closest('thead, [data-selection-header]'));
    if (!isHeader) continue;
    let scope: Element | null = header.closest('table') ?? header.parentElement;
    let firstRow: HTMLElement | undefined;
    while (scope && scope !== document.body) {
      firstRow = allCheckboxes.find(
        (c) =>
          c !== header &&
          scope!.contains(c) &&
          !c.closest('thead, [data-selection-header]') &&
          Boolean(header.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING),
      );
      if (firstRow || scope.tagName === 'TABLE') break;
      scope = scope.parentElement;
    }
    if (!firstRow) continue;
    const dx = centerX(indicatorOf(firstRow)) - centerX(indicatorOf(header));
    if (Math.abs(dx) > 1) issues.push(`selection-column:${describe(header)}:dx${f(dx)}`);
  }

  // ---- 5. breadcrumb text alignment ---------------------------------------
  // Interactive ancestors can have 44px targets while the current page is a
  // 20px text box. Their containers may align even when a block link leaves its
  // text at the top, so compare actual text lines rather than element boxes.
  for (const list of document.querySelectorAll<HTMLElement>('[data-slot=breadcrumb-list]')) {
    if (!isVisible(list)) continue;
    let topmost: { label: string; rect: DOMRect } | undefined;
    let bottommost: { label: string; rect: DOMRect } | undefined;
    for (const item of list.querySelectorAll<HTMLElement>(':scope > [data-slot=breadcrumb-item]')) {
      if (!isVisible(item)) continue;
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          return node.textContent?.trim() && parent && isVisible(parent) &&
            !parent.closest('.sr-only, [aria-hidden=true], svg')
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const line = [...range.getClientRects()].find((rect) => rect.width > 0 && rect.height > 0);
        if (!line) continue;
        const current = { label: node.textContent!.trim().slice(0, 20), rect: line };
        if (!topmost || centerY(current.rect) < centerY(topmost.rect)) topmost = current;
        if (!bottommost || centerY(current.rect) > centerY(bottommost.rect)) bottommost = current;
        break;
      }
    }
    // Compare the complete row; adjacent-only comparisons miss 0/2/4px drift.
    if (topmost && bottommost) {
      const dy = centerY(bottommost.rect) - centerY(topmost.rect);
      if (dy > 2) issues.push(`breadcrumb-misaligned:${topmost.label}→${bottommost.label}:dy${f(dy)}`);
    }
  }

  return issues;
}
