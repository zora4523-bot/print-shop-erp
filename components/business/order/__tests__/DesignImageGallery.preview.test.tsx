import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesignImageGallery } from '../DesignImageGallery';

describe('DesignImageGallery 预览图', () => {
  it('网格用缩放预览并延迟加载，点开仍是原图', () => {
    const html = renderToStaticMarkup(
      <DesignImageGallery
        images={[{ id: 'd1', fileName: '福字.png', fileUrl: 'https://oss/original.png', previewUrl: 'https://oss/original.png?x-oss-process=w480' }]}
      />,
    );
    expect(html).toMatch(/<a[^>]+href="https:\/\/oss\/original.png"/);
    expect(html).toMatch(/<img[^>]+src="https:\/\/oss\/original.png\?x-oss-process=w480"/);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it('没有预览地址时退回原图', () => {
    const html = renderToStaticMarkup(
      <DesignImageGallery images={[{ id: 'd1', fileName: 'a.png', fileUrl: 'https://oss/a.png' }]} />,
    );
    expect(html).toMatch(/<img[^>]+src="https:\/\/oss\/a.png"/);
  });
});
