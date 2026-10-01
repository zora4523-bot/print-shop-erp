'use client';

/** 打开 / 下载批量打印文件的浏览器导航，单独成模块以便组件测试替换真实导航。 */
export function openBlankPrintTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return tab;
}

export function navigateToPrintFile(url: string, tab: Window | null): void {
  if (tab) tab.location.href = url;
  else window.location.assign(url);
}
