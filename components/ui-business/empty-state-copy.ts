export const EMPTY_NO_ACCESS_TITLE = '找不到这个页面，或你没有访问权限';
export const EMPTY_NO_ACCESS_DESCRIPTION =
  '如果你认为这是误判，请联系管理员开通权限。';
export const EMPTY_NO_ACCESS_ACTION = '回我的工作台';
export const EMPTY_NO_ACCESS_HOME_HREF = '/owner';

// 空态措辞（docs/ui-规范.md §5.5）：无数据「暂无X」，有筛选「没有匹配的X」。
export function emptyNoDataTitle(noun: string): string {
  return `暂无${noun}`;
}

export function emptyNoDataDescription(noun: string): string {
  return `${noun}创建后会出现在这里。`;
}

export function emptyNoResultTitle(noun: string): string {
  return `没有匹配的${noun}`;
}

export const EMPTY_NO_RESULT_DESCRIPTION = '试试放宽条件';
