export interface FeishuStatusContextInput {
  senderId: string | null;
  chatId: string;
  sourceThreadId: string;
  remoteThreadId?: string | null;
  remoteThreadShortId?: string | null;
}

export const buildFeishuStatusContextLines = (
  input: FeishuStatusContextInput,
): string[] => [
  "当前上下文",
  `当前用户飞书 ID：${input.senderId ?? "未知"}`,
  `当前对话 ID：${input.remoteThreadId ?? "暂无"}`,
  `当前对话短 ID：${input.remoteThreadShortId ? `#${input.remoteThreadShortId}` : "暂无"}`,
  `当前群/私聊 ID（Chat ID）：${input.chatId}`,
  `当前消息链 ID：${input.sourceThreadId}`,
];
