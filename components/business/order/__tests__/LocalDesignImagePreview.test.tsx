import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesignFileType } from '@/generated/prisma/enums';
import { formatDesignFileSize } from '../design-file-display';
import { LocalDesignImagePreview } from '../LocalDesignImagePreview';

function prepared(fileType: DesignFileType) {
  return {
    file: { name: 'design.png', size: 48 * 1024 } as File,
    fileType,
    mimeType:
      fileType === DesignFileType.IMAGE
        ? 'image/png'
        : 'application/octet-stream',
  };
}

describe('LocalDesignImagePreview', () => {
  it('renders only prepared image files as an accessible preview', () => {
    const imageHtml = renderToStaticMarkup(
      <LocalDesignImagePreview
        image={prepared(DesignFileType.IMAGE)}
        alt="第 1 款设计图预览：design.png"
      />,
    );
    const cdrHtml = renderToStaticMarkup(
      <LocalDesignImagePreview
        image={prepared(DesignFileType.CDR)}
        alt="不应显示"
      />,
    );

    expect(imageHtml).toContain('data-slot="local-design-image-preview"');
    expect(imageHtml).toContain('第 1 款设计图预览：design.png');
    expect(imageHtml).toContain('decoding="async"');
    expect(cdrHtml).toBe('');
  });

  it('uses KB for small files instead of displaying 0.0 MB', () => {
    expect(formatDesignFileSize(48 * 1024)).toBe('48 KB');
    expect(formatDesignFileSize(1024 * 1024)).toBe('1.0 MB');
  });
});
