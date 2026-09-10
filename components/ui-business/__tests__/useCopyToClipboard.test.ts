import { describe, expect, it } from 'vitest';
import { copyFeedbackMessage } from '../useCopyToClipboard';

describe('copyFeedbackMessage', () => {
  it('names the copied value and truncates long ones', () => {
    expect(copyFeedbackMessage('工单号', 'GD-260719-003', true)).toBe('已复制工单号 GD-260719-003');
    expect(copyFeedbackMessage('绑定码', 'x'.repeat(40), true)).toBe(`已复制绑定码 ${'x'.repeat(24)}…`);
  });

  it('reports counts for multi-value copies', () => {
    expect(copyFeedbackMessage('工单号', 'a\nb', true, 2)).toBe('已复制 2 个工单号');
    expect(copyFeedbackMessage('工单号', 'a', true, 1)).toBe('已复制工单号 a');
  });

  it('gives an actionable next step on failure', () => {
    expect(copyFeedbackMessage('工单号', 'a', false)).toBe('工单号复制失败，请手动选择复制或检查浏览器剪贴板权限');
  });
});
