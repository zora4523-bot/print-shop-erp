import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import '@/app/globals.css';
import { Button } from '@/components/ui/button';
import { EditorTabs } from '@/components/ui/editor-tabs';

let host: HTMLElement;
let root: Root;
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

const tabs = [{ value: 'a', label: '设计款 1' }, { value: 'b', label: '设计款 2' }] as const;

// §8.2：选中态只有一种。folder 形态只保留形状差异，颜色与字重必须与 variant="selected" 一致。
for (const variant of ['outline', 'folder'] as const) {
  it(`${variant} tabs use the standard selected look`, () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => root.render(<>
      <EditorTabs id={`t-${variant}`} label="设计款" tabs={tabs} value="a" onChange={() => undefined} variant={variant} />
      <Button variant="selected" data-testid="reference">参照</Button>
    </>));
    const selected = getComputedStyle(host.querySelector('[role="tab"][aria-selected="true"]')!);
    const other = getComputedStyle(host.querySelector('[role="tab"][aria-selected="false"]')!);
    const reference = getComputedStyle(host.querySelector('[data-testid="reference"]')!);
    expect(selected.color).toBe(reference.color);
    expect(selected.backgroundColor).toBe(reference.backgroundColor);
    expect(selected.fontWeight).toBe(reference.fontWeight);
    expect(other.color).not.toBe(reference.color);
  });
}
