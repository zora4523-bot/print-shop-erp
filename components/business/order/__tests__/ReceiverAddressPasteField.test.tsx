import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReceiverAddressPasteField } from '../ReceiverAddressPasteField';

describe('ReceiverAddressPasteField', () => {
  it('renders one growing textarea with the paste placeholder and a11y wiring', () => {
    const html = renderToStaticMarkup(
      <ReceiverAddressPasteField id="x-receiver-address-paste" value="" required invalid={false} describedBy="x-msg" onChange={vi.fn()} />,
    );
    expect(html).toContain('id="x-receiver-address-paste"');
    expect(html).toContain('粘贴电商后台地址串，自动拆分');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('aria-describedby="x-msg"');
    expect(html).toContain('field-sizing-content');
    expect(html).not.toContain('平台码');
  });

  it('shows the parsed address and platform code, with contact fields inside the preview', () => {
    const html = renderToStaticMarkup(
      <ReceiverAddressPasteField id="y" value="张三，13800000000，浙江省杭州市测试路1号 [AB12]" onChange={vi.fn()}>
        <span data-testid="contacts">contacts</span>
      </ReceiverAddressPasteField>,
    );
    expect(html).toContain('浙江省杭州市测试路1号');
    expect(html).toContain('[AB12]');
    // The textarea echoes the raw value first; the preview rows follow the contact slot.
    expect(html.indexOf('data-testid="contacts"')).toBeLessThan(html.indexOf('平台码'));
    expect(html.lastIndexOf('浙江省杭州市测试路1号')).toBeGreaterThan(html.indexOf('data-testid="contacts"'));
  });

  it('submits under the given name for native forms', () => {
    const html = renderToStaticMarkup(<ReceiverAddressPasteField id="receiverAddress" name="receiverAddress" value="x" onChange={vi.fn()} />);
    expect(html).toContain('name="receiverAddress"');
  });
});
