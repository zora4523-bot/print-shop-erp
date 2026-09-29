import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import '@/app/globals.css';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

let host: HTMLElement;
let root: Root;

afterEach(() => {
  root.unmount();
  host.remove();
});

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(node));
}

const style = (label: string) => getComputedStyle(host.querySelector(`[aria-label="${label}"]`)!);

it('styles only explicit readOnly fields as read-only, not file or disabled inputs', () => {
  render(<>
    <Input aria-label="只读" readOnly value="企业微信群" />
    <Input aria-label="可编辑" defaultValue="排产群" />
    <Input aria-label="上传" type="file" />
    <Textarea aria-label="只读备注" readOnly value="历史备注" />
  </>);
  expect(style('只读').borderTopStyle).toBe('dashed');
  expect(style('只读备注').borderTopStyle).toBe('dashed');
  // type=file matches the :read-only pseudo-class per HTML, yet stays editable.
  expect(style('上传').borderTopStyle).toBe('solid');
  expect(style('可编辑').borderTopStyle).toBe('solid');
  expect(style('只读').backgroundColor).not.toBe(style('可编辑').backgroundColor);
});
