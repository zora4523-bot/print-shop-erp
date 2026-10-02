export type CdrBundleFailureDisplay = {
  title: string;
  description: string;
};

/**
 * Translate persisted technical error codes into safe operator guidance.
 * Unknown codes are intentionally never echoed because they can originate
 * from storage providers or thrown error names.
 */
export function cdrBundleFailureDisplay(
  errorCode: string | null,
): CdrBundleFailureDisplay {
  if (errorCode === 'CdrBundleStaleError') return { title: '文件已更新', description: '请核对最新工单后重新生成下载包。' };
  if (errorCode === 'CancelledByOperator') {
    return {
      title: '任务已取消',
      description: '如仍需交付，请核对工单范围后按同条件重新生成。',
    };
  }
  if (
    errorCode === 'WorkerLeaseExpired' ||
    errorCode === 'AbortError' ||
    errorCode === 'TimeoutError'
  ) {
    return {
      title: '后台处理超时',
      description: '旧任务不会继续生成；可按同条件创建一个新的下载包。',
    };
  }
  if (errorCode === 'CdrBundleError' || errorCode === 'CdrZipError') {
    return {
      title: '文件或存储处理失败',
      description: '请先确认源 CDR 文件和对象存储可用，再按同条件重新生成。',
    };
  }
  return {
    title: '后台生成失败',
    description: '技术原因已记录；可按同条件重新生成，若再次失败请联系管理员排查后台任务。',
  };
}
