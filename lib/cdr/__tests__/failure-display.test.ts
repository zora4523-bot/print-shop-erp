import { describe, expect, it } from 'vitest';
import { cdrBundleFailureDisplay } from '../failure-display';

describe('cdrBundleFailureDisplay', () => {
  it('gives cancelled, timeout and file failures distinct recovery guidance', () => {
    expect(cdrBundleFailureDisplay('CancelledByOperator').title).toBe(
      '任务已取消',
    );
    expect(cdrBundleFailureDisplay('WorkerLeaseExpired').title).toBe(
      '后台处理超时',
    );
    expect(cdrBundleFailureDisplay('CdrZipError').title).toBe(
      '文件或存储处理失败',
    );
  });

  it('never reflects an unknown raw provider error into the UI', () => {
    const secretBearingCode = 'AccessDenied: token=private';
    const display = cdrBundleFailureDisplay(secretBearingCode);

    expect(display.title).toBe('后台生成失败');
    expect(display.description).not.toContain(secretBearingCode);
    expect(display.description).toContain('联系管理员');
  });
});
