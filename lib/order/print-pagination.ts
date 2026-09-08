/**
 * Final A4 geometry pass after fonts and artwork settle. This function is
 * deliberately self-contained: the PDF document embeds the same function
 * source that the browser print route calls, without a second paginator.
 * Move real DOM nodes so no task, address, artwork or full-text annex is lost.
 */
export function paginatePrintDocument(documentTarget: Document): boolean {
  const documentRoot = documentTarget.querySelector<HTMLElement>('.work-order-document');
  if (!documentRoot) return true;
  const ruler = documentTarget.createElement('div');
  ruler.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;height:297mm;width:1px';
  documentRoot.append(ruler);
  const pageHeight = ruler.getBoundingClientRect().height;
  ruler.remove();
  if (!pageHeight) return true;

  let valid = true;
  let operations = 0;
  for (let index = 0; index < documentRoot.children.length; index += 1) {
    const sheet = documentRoot.children[index] as HTMLElement;
    if (!sheet.classList.contains('sheet')) continue;
    let continuation: HTMLElement | null = null;
    while (sheet.getBoundingClientRect().height > pageHeight + 0.5) {
      operations += 1;
      if (operations > 2000) { valid = false; break; }
      const header = sheet.querySelector<HTMLElement>(':scope > .hd');
      const footer = sheet.querySelector<HTMLElement>(':scope > .ft');
      let candidate: HTMLElement | null = null;
      // A main sheet keeps its complete shipping block. Move the flow table
      // or artwork first instead of creating a continuation with only an address.
      for (const section of sheet.querySelectorAll<HTMLElement>(':scope > .sec')) {
        if (section.getBoundingClientRect().height === 0) continue;
        if (!section.querySelector('.ship-list')) candidate = section;
      }
      if (!candidate) candidate = sheet.querySelector<HTMLElement>(':scope > .sec');
      if (!header || !footer || !candidate) { valid = false; break; }
      const contentCount = sheet.querySelectorAll(':scope > .sec').length;
      if (contentCount === 1 && candidate.getBoundingClientRect().height > pageHeight -
        header.getBoundingClientRect().height - footer.getBoundingClientRect().height) {
        // Bounded rows/images below can still split; a single indivisible
        // record must fail visibly rather than loop or silently clip it.
        const units = candidate.querySelectorAll('tbody > tr, .art > .thumb, .ship-list > .ship');
        const longAddress = candidate.querySelector('.ship-list > .ship > div:last-child');
        if (units.length < 2 && (longAddress?.textContent?.length ?? 0) < 2) { valid = false; break; }
      }
      if (!continuation) {
        continuation = sheet.cloneNode(false) as HTMLElement;
        continuation.removeAttribute('id');
        continuation.dataset.printContinuation = 'true';
        continuation.append(header.cloneNode(true), footer.cloneNode(true));
        sheet.after(continuation);
      }
      const continuationFooter = continuation.querySelector<HTMLElement>(':scope > .ft')!;
      const firstSection = continuation.querySelector<HTMLElement>(':scope > .sec');
      const table = candidate.querySelector<HTMLTableElement>('table');
      const grid = candidate.querySelector<HTMLElement>('.art');
      const shipping = candidate.querySelector<HTMLElement>('.ship-list');
      const source = table?.tBodies[0] ?? grid ?? shipping;
      if (shipping && source?.children.length === 1 && contentCount === 1) {
        // A legal multiline address can exceed one page on its own. Split
        // only its text, repeating receiver/carrier context on each part.
        const address = shipping.querySelector<HTMLElement>('.ship > div:last-child');
        const characters = Array.from(address?.textContent ?? '');
        if (!address || characters.length < 2) { valid = false; break; }
        let low = 1;
        let high = characters.length - 1;
        let fits = 0;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          address.textContent = characters.slice(0, middle).join('');
          if (sheet.getBoundingClientRect().height <= pageHeight + 0.5) {
            fits = middle;
            low = middle + 1;
          } else high = middle - 1;
        }
        if (!fits) {
          address.textContent = characters.join('');
          valid = false;
          break;
        }
        address.textContent = characters.slice(0, fits).join('');
        const split = candidate.cloneNode(true) as HTMLElement;
        split.querySelector<HTMLElement>('.ship > div:last-child')!.textContent = characters.slice(fits).join('');
        continuation.insertBefore(split, firstSection ?? continuationFooter);
      } else if (source && source.children.length > 1) {
        const split = candidate.cloneNode(true) as HTMLElement;
        const splitTable = split.querySelector<HTMLTableElement>('table');
        const destination = splitTable?.tBodies[0] ?? split.querySelector<HTMLElement>('.art, .ship-list');
        if (!destination) { valid = false; break; }
        destination.replaceChildren();
        // The summary belongs only after the final row, on the continuation.
        if (table?.tFoot) table.tFoot.remove();
        continuation.insertBefore(split, firstSection ?? continuationFooter);
        while (source.children.length > 1 && sheet.getBoundingClientRect().height > pageHeight + 0.5) {
          destination.prepend(source.lastElementChild!);
        }
        if (sheet.getBoundingClientRect().height > pageHeight + 0.5) {
          destination.prepend(source.lastElementChild!);
          candidate.remove();
        }
      } else {
        continuation.insertBefore(candidate, firstSection ?? continuationFooter);
      }
      // If there is no section left, an oversized header is the cause. Moving
      // it forever cannot make a valid page; preserve the content and fail closed.
      if (!sheet.querySelector(':scope > .sec') && sheet.getBoundingClientRect().height > pageHeight + 0.5) {
        valid = false;
        break;
      }
    }
    if (!valid) break;
  }
  const sheets = documentRoot.querySelectorAll<HTMLElement>(':scope > .sheet');
  for (let index = 0; index < sheets.length; index += 1) {
    sheets[index].dataset.printPage = String(index + 1);
    const pageNumber = sheets[index].querySelector<HTMLElement>(':scope > .ft > :last-child');
    if (pageNumber) pageNumber.textContent = `${index + 1} / ${sheets.length}`;
  }
  documentTarget.documentElement.dataset.printPagination = valid ? 'ready' : 'overflow';
  documentRoot.dataset.printPrepared = 'true';
  if (!valid && !documentRoot.querySelector('[data-print-error]')) {
    const warning = documentTarget.createElement('p');
    warning.dataset.printError = 'true';
    warning.setAttribute('role', 'alert');
    warning.textContent = '打印内容超出 A4 页面，已停止自动打印。请检查过长的单条内容后重新生成。';
    warning.style.cssText = 'max-width:210mm;margin:1rem auto;padding:1rem;background:white;color:#a8121a';
    documentRoot.prepend(warning);
  }
  return valid;
}

export function printPaginationScript(): string {
  return `(${paginatePrintDocument.toString()})(document)`;
}
