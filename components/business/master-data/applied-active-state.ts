// 启用/停用按钮的回执必须按「这次提交的目标状态」播报，而不是按当前 props。
// 成功的 action 会 revalidatePath，同一次响应里页面带着新的 isActive 重渲，
// 组件不重挂、useActionState 的成功结果仍在——此时 currentlyActive 已翻转，
// 用它推导标题会把「已停用」说成「已启用」。把目标值随结果一起存进 action state。
export type AppliedActiveState<Result> = Result & { appliedActive: boolean };

export function withAppliedActive<Result extends object>(
  result: Result,
  appliedActive: boolean,
): AppliedActiveState<Result> {
  return { ...result, appliedActive };
}
