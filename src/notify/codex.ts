import path from "path";
import { readConfig } from "../config/store";
import type { HookEntry } from "../storage/hooks";
import { sendDingTalkMarkdown } from "./dingtalk";
import { sendFeishuText } from "./feishu";
import { quoteMarkdown } from "./transcript";

export type CodexWebhookEventKey = "stop" | "subagentStop" | "notification";

export interface CodexWebhookMessage {
  title: string;
  eventLabel: string;
  dingTalkMarkdown: string;
  feishuText: string;
}

const stringField = (payload: unknown, key: string): string | null => {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
};

const projectBasename = (cwd: string | null): string => {
  if (!cwd) return "";
  return path.basename(cwd.replace(/[/\\]+$/, ""));
};

export const codexWebhookEventKey = (
  eventName: string,
): CodexWebhookEventKey | null => {
  if (eventName === "Stop") return "stop";
  if (eventName === "SubagentStop") return "subagentStop";
  if (eventName === "PermissionRequest") return "notification";
  return null;
};

export const buildCodexWebhookMessage = (
  entry: HookEntry,
  now = new Date(),
): CodexWebhookMessage => {
  const projectName = projectBasename(entry.cwd);
  const sessionTail = entry.sessionId ? entry.sessionId.slice(-6) : "unknown";
  const title = projectName ? `Codex · ${projectName}` : "Codex";
  const toolName = entry.toolName ?? stringField(entry.payload, "tool_name");

  let eventLabel: string;
  if (entry.eventName === "Stop") eventLabel = "任务完成";
  else if (entry.eventName === "SubagentStop") eventLabel = "子代理完成";
  else if (entry.eventName === "PermissionRequest") {
    eventLabel = toolName ? `等待授权 · ${toolName}` : "等待授权";
  } else eventLabel = entry.eventName;

  const lastAssistant =
    entry.eventName === "Stop" || entry.eventName === "SubagentStop"
      ? stringField(entry.payload, "last_assistant_message")
      : null;
  const time = now.toLocaleString();
  const commonLines = [
    `session: ${sessionTail}`,
    projectName ? `project: ${projectName}` : null,
    toolName && entry.eventName === "PermissionRequest" ? `tool: ${toolName}` : null,
    `time: ${time}`,
  ].filter((line): line is string => !!line);
  const dingTalkLines = [
    `- session: \`${sessionTail}\``,
    projectName ? `- project: \`${projectName}\`` : null,
    toolName && entry.eventName === "PermissionRequest" ? `- tool: \`${toolName}\`` : null,
    `- time: ${time}`,
  ].filter((line): line is string => !!line);

  const dingTalkMarkdown = [
    `### ${title}`,
    `**${eventLabel}** (${entry.eventName})`,
    "",
    ...dingTalkLines,
    lastAssistant
      ? `\n**最后回复**\n\n${quoteMarkdown(lastAssistant)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const feishuText = [
    title,
    `${eventLabel} (${entry.eventName})`,
    ...commonLines,
    lastAssistant ? `\n最后回复:\n${lastAssistant}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return { title, eventLabel, dingTalkMarkdown, feishuText };
};

export const dispatchCodexWebhookNotifications = (entry: HookEntry): void => {
  const eventKey = codexWebhookEventKey(entry.eventName);
  if (!eventKey) return;

  const notifications = readConfig().codexNotifications;
  const dingTalk = notifications?.dingtalk;
  const feishu = notifications?.feishu;
  const dingTalkOn = !!dingTalk?.enabled && !!dingTalk.events?.[eventKey];
  const feishuOn = !!feishu?.enabled && !!feishu.events?.[eventKey];
  if (!dingTalkOn && !feishuOn) return;

  const message = buildCodexWebhookMessage(entry);
  if (dingTalkOn && dingTalk?.accessToken && dingTalk.secret) {
    void sendDingTalkMarkdown(
      dingTalk.accessToken,
      dingTalk.secret,
      `${message.title} · ${message.eventLabel}`,
      message.dingTalkMarkdown,
    ).then((result) => {
      if (!result.ok) console.warn(`[codex:dingtalk] 发送失败: ${result.error}`);
    });
  }

  if (feishuOn && feishu?.webhookUrl) {
    void sendFeishuText(
      feishu.webhookUrl,
      feishu.secret ?? "",
      message.feishuText,
    ).then((result) => {
      if (!result.ok) console.warn(`[codex:feishu] 发送失败: ${result.error}`);
    });
  }
};
