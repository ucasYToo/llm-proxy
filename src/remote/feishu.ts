import fs from "fs";
import path from "path";
import * as lark from "@larksuiteoapi/node-sdk";
import { readConfig } from "../config/store";
import type {
  RemoteBridgeFeishuBotConfig,
  RemoteBridgeFeishuProgressCardConfig,
} from "../interfaces";
import { getKnownProjects, type KnownProject } from "../core/session";
import { recentSessions, type SessionSummary } from "../storage/hooks";
import {
  attachRemoteSession,
  getRemoteProgressSnapshot,
  onRemoteEvent,
  registerRemoteOutboundSender,
  sendRemoteMessage,
  stopRemoteThread,
  submitPermissionVerdict,
  type RemoteOutboundKind,
} from "./service";
import type { RemoteThread, RemoteMessage } from "../storage/remote";
import {
  createRemoteMessageCard,
  findLatestRemoteThreadForSource,
  getRemoteThread,
  getLatestRemoteMessageCardForThread,
  getRemoteMessageCardByInbound,
  queryRemoteChannelInstances,
  queryRemoteMessages,
  queryRemoteThreads,
  updateRemoteThread,
  updateRemoteMessageCard,
  type RemoteMessageCard,
} from "../storage/remote";
import {
  buildFeishuProgressCard,
  splitFeishuText,
} from "./feishu-card";
import { markProgressDone, markProgressFailed, type RemoteProgressSnapshot } from "./progress";
import {
  parseFeishuRemoteCommand,
  parseFeishuTextContent,
  parsePermissionReply,
  type FeishuRemoteCommand,
} from "./feishu/parser";
import { buildFeishuStatusContextLines } from "./feishu/status";

interface FeishuRuntime {
  bot: ActiveFeishuBot;
  client: lark.Client;
  wsClient: any;
}

type NormalizedFeishuBot = Required<Pick<RemoteBridgeFeishuBotConfig, "id" | "name">> &
  RemoteBridgeFeishuBotConfig;

type ActiveFeishuBot = NormalizedFeishuBot & {
  appId: string;
  appSecret: string;
};

let runtimes = new Map<string, FeishuRuntime>();
let unregisterSender: (() => void) | null = null;
let unregisterProgress: (() => void) | null = null;
const PATCH_MIN_INTERVAL_MS = 210;
const cardPatchFailureNotified = new Set<string>();
const cardPatchQueues = new Map<string, Promise<RemoteMessageCard | null>>();
const cardPatchTimers = new Map<string, ReturnType<typeof setTimeout>>();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const normalizeBotId = (id: string | undefined, index: number): string => {
  const value = id?.trim();
  if (value && /^[a-zA-Z0-9_-]+$/.test(value)) return value;
  return index === 0 ? "default" : `bot-${index + 1}`;
};

const configuredFeishuBots = (): NormalizedFeishuBot[] => {
  const bridge = readConfig().remoteBridge;
  const feishu = bridge?.feishu;
  const bots =
    Array.isArray(feishu?.bots) && feishu.bots.length > 0
      ? feishu.bots
      : feishu?.appId || feishu?.appSecret
        ? [
            {
              id: "default",
              name: "默认机器人",
              enabled: true,
              defaultCwd: bridge?.defaultCwd,
              appId: feishu.appId,
              appSecret: feishu.appSecret,
              encryptKey: feishu.encryptKey,
              verificationToken: feishu.verificationToken,
              allowedUserIds: feishu.allowedUserIds,
              progressCard: feishu.progressCard,
            },
          ]
        : [];
  return bots.map((bot, index) => ({
    ...bot,
    id: normalizeBotId(bot.id, index),
    name: bot.name?.trim() || (index === 0 ? "默认机器人" : `机器人 ${index + 1}`),
    enabled: bot.enabled ?? true,
  }));
};

const activeFeishuBots = (): ActiveFeishuBot[] =>
  configuredFeishuBots()
    .filter((bot) => bot.enabled && !!bot.appId && !!bot.appSecret)
    .map((bot) => ({
      ...bot,
      appId: bot.appId ?? "",
      appSecret: bot.appSecret ?? "",
    }));

const runtimeForBot = (botId?: string | null): FeishuRuntime | null => {
  if (botId) return runtimes.get(botId) ?? null;
  return runtimes.values().next().value ?? null;
};

const progressCardConfig = (
  botId?: string | null,
): Required<RemoteBridgeFeishuProgressCardConfig> => {
  const feishu = readConfig().remoteBridge?.feishu;
  const globalCfg = feishu?.progressCard;
  const botCfg = configuredFeishuBots().find((bot) => bot.id === botId)?.progressCard;
  const cfg = { ...(globalCfg ?? {}), ...(botCfg ?? {}) };
  return {
    enabled: cfg.enabled ?? true,
    showPartialAnswer: cfg.showPartialAnswer ?? true,
    showToolEvents: cfg.showToolEvents ?? true,
  };
};

const allowedUsersForBot = (botId: string): string[] => {
  const feishu = readConfig().remoteBridge?.feishu;
  const bot = configuredFeishuBots().find((item) => item.id === botId);
  return bot?.allowedUserIds ?? feishu?.allowedUserIds ?? [];
};

const defaultCwdForBot = (botId?: string | null): string | null => {
  const cfg = readConfig().remoteBridge;
  const bot = configuredFeishuBots().find((item) => item.id === botId);
  return bot?.defaultCwd?.trim() || cfg?.defaultCwd || null;
};

const textWithoutBotMention = (text: string): string =>
  text.replace(/@\S+\s*/g, "").trim();

const pickSenderId = (event: Record<string, any>): string | null => {
  const senderId = event.sender?.sender_id ?? {};
  return (
    senderId.open_id ??
    senderId.user_id ??
    senderId.union_id ??
    event.sender?.sender_type ??
    null
  );
};

const shouldHandleGroupMessage = (message: Record<string, any>): boolean => {
  const chatType = message.chat_type ?? message.chatType;
  if (chatType === "p2p") return true;
  if (Array.isArray(message.mentions) && message.mentions.length > 0) {
    return true;
  }
  return !!message.parent_id || !!message.root_id;
};

const resolveCwdFromAlias = (
  raw: string | undefined,
  botId?: string | null,
): string | null => {
  const cfg = readConfig().remoteBridge;
  if (!raw) return defaultCwdForBot(botId) ?? process.cwd();
  if (path.isAbsolute(raw)) return raw;
  const allowed = cfg?.allowedCwds ?? [];
  const found = allowed.find((cwd) => path.basename(cwd) === raw || cwd === raw);
  return found ?? defaultCwdForBot(botId);
};

const matchesProjectAlias = (project: KnownProject, value: string): boolean =>
  project.cwd === value ||
  path.basename(project.cwd) === value ||
  project.remark === value;

const resolveCwdFromAliasStrict = (
  raw: string | undefined,
  botId?: string | null,
): string | null => {
  const value = raw?.trim();
  if (!value) return null;
  if (path.isAbsolute(value)) return value;
  const cfg = readConfig().remoteBridge;
  const botDefaultCwd = defaultCwdForBot(botId);
  const candidates = [
    ...(cfg?.allowedCwds ?? []),
    ...(botDefaultCwd ? [botDefaultCwd] : []),
  ];
  const configured = candidates.find((cwd) => path.basename(cwd) === value || cwd === value);
  if (configured) return configured;
  const known = getKnownProjects().find((project) =>
    matchesProjectAlias(project, value),
  );
  return known?.cwd ?? null;
};

const splitFirstToken = (
  input: string,
): { first: string; rest: string } | null => {
  const match = /^(\S+)(?:\s+([\s\S]+))?$/.exec(input.trim());
  if (!match) return null;
  return { first: match[1], rest: (match[2] ?? "").trim() };
};

const resolveNewCommandInput = (
  input: string,
  botId?: string | null,
): { cwd: string | null | undefined; text: string } => {
  const parts = splitFirstToken(input);
  if (parts?.rest) {
    const cwd = resolveCwdFromAliasStrict(parts.first, botId);
    if (cwd) return { cwd, text: parts.rest };
  }
  return { cwd: resolveCwdFromAlias(undefined, botId), text: input.trim() };
};

const formatThreadLine = (thread: RemoteThread): string => {
  const project = thread.cwd ? path.basename(thread.cwd) : "unknown";
  const title = thread.title?.trim();
  return title
    ? `#${thread.shortId} · ${thread.status} · ${project} · ${truncateText(title, 30)}`
    : `#${thread.shortId} · ${thread.status} · ${project}`;
};

const normalizeThreadTarget = (target: string): string =>
  target.trim().replace(/^#/, "");

const truncateText = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;

const relativeTime = (iso: string | null): string => {
  if (!iso) return "未知时间";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const diff = Math.max(0, Date.now() - ts);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h前`;
  const days = Math.floor(hours / 24);
  return `${days}d前`;
};

const TABLE_VISIBLE_COUNT = 10;

const threadStatusLabel = (status: RemoteThread["status"]): string => {
  switch (status) {
    case "pending":
      return "待处理";
    case "queued":
      return "排队";
    case "running":
      return "运行中";
    case "waiting_permission":
      return "待审批";
    case "done":
      return "完成";
    case "failed":
      return "失败";
    default:
      return status;
  }
};

const buildHelpText = (): string =>
  [
    "Claude Code 远程助手",
    "",
    "常用：",
    "/new <项目> <任务> 新建远程任务",
    "/use <threadId> 切换当前聊天默认对话",
    "/status [threadId] 查看当前或指定对话状态",
    "/projects 查看可用项目",
    "/threads 查看最近对话",
    "/sessions [项目] 查看最近本地 Claude 会话",
    "",
    "继续：",
    "普通消息 继续当前默认对话",
    "/continue <threadId> <任务> 继续指定对话",
    "/use-session <sessionId> 绑定本地 Claude 会话",
    "/continue-session <sessionId> <任务> 继续本地 Claude 会话",
    "",
    "管理：",
    "/show <threadId> 查看对话详情",
    "/stop [threadId] 停止当前或指定任务",
    "",
    "审批：",
    "同意 <id>",
    "拒绝 <id>",
    "",
    "兼容：以上命令也可以写成 /cc ...",
  ].join("\n");

interface ProjectListResult {
  projects: KnownProject[];
  defaultCwd: string;
  allowedCwds: string[];
}

const listRemoteProjects = (botId?: string): ProjectListResult => {
  const cfg = readConfig().remoteBridge;
  const allowed = cfg?.allowedCwds ?? [];
  const defaultCwd = defaultCwdForBot(botId) ?? process.cwd();
  const knownProjects = getKnownProjects();
  const projectMap = new Map<string, KnownProject>();
  for (const project of knownProjects) projectMap.set(project.cwd, project);
  if (defaultCwd && !projectMap.has(defaultCwd)) {
    projectMap.set(defaultCwd, {
      cwd: defaultCwd,
      remark: null,
      lastSeen: new Date().toISOString(),
    });
  }
  for (const cwd of allowed) {
    if (!projectMap.has(cwd)) {
      projectMap.set(cwd, {
        cwd,
        remark: null,
        lastSeen: new Date().toISOString(),
      });
    }
  }

  const projects = [...projectMap.values()].sort((a, b) => {
    const aDefault = a.cwd === defaultCwd ? 1 : 0;
    const bDefault = b.cwd === defaultCwd ? 1 : 0;
    if (aDefault !== bDefault) return bDefault - aDefault;
    return Date.parse(b.lastSeen) - Date.parse(a.lastSeen);
  });
  return { projects, defaultCwd, allowedCwds: allowed };
};

const projectSourceLabel = (
  project: KnownProject,
  defaultCwd: string,
  allowedCwds: string[],
): string => {
  if (project.cwd === defaultCwd) return "默认";
  if (allowedCwds.includes(project.cwd)) return "固定";
  return "最近";
};

const buildProjectsText = (botId?: string): string => {
  const { projects, defaultCwd, allowedCwds } = listRemoteProjects(botId);
  const lines = ["项目列表"];
  lines.push(`默认：${path.basename(defaultCwd)} — ${defaultCwd}`);
  if (projects.length === 0) {
    lines.push("暂无项目记录。先在 Dashboard 或 Claude Code 中运行一次项目。");
  } else {
    for (const project of projects.slice(0, 30)) {
      const alias = project.remark?.trim() || path.basename(project.cwd);
      const marker = projectSourceLabel(project, defaultCwd, allowedCwds);
      const remark = project.remark?.trim() ? `（备注：${project.remark.trim()}）` : "";
      lines.push(`${marker} · ${alias} — ${project.cwd}${remark}`);
    }
    if (projects.length > 30) {
      lines.push(`还有 ${projects.length - 30} 个项目未显示，请到 Dashboard 项目页查看。`);
    }
  }
  lines.push("");
  lines.push("用法：/new <项目别名或备注> <prompt> 或 /new <prompt>");
  if (allowedCwds.length > 0) {
    lines.push("补充 allowedCwds 仍可用于启动未出现在项目列表里的固定目录。");
  }
  return lines.join("\n");
};

const buildProjectsCard = (botId?: string): Record<string, unknown> => {
  const { projects, defaultCwd, allowedCwds } = listRemoteProjects(botId);
  const visibleProjects = projects.slice(0, TABLE_VISIBLE_COUNT);
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "div",
      text: plainText(`默认：${path.basename(defaultCwd)} · ${defaultCwd}`),
    },
  ];

  if (projects.length === 0) {
    elements.push({
      tag: "div",
      text: plainText("暂无项目记录。先在 Dashboard 或 Claude Code 中运行一次项目。"),
    });
  } else {
    elements.push({
      tag: "table",
      page_size: TABLE_VISIBLE_COUNT,
      row_height: "low",
      freeze_first_column: true,
      header_style: {
        text_align: "left",
        text_size: "normal",
        background_style: "none",
        text_color: "grey",
        bold: true,
        lines: 1,
      },
      columns: [
        {
          name: "alias",
          display_name: "项目",
          data_type: "text",
          width: "150px",
          vertical_align: "top",
          horizontal_align: "left",
        },
        {
          name: "source",
          display_name: "来源",
          data_type: "text",
          width: "70px",
          vertical_align: "top",
          horizontal_align: "left",
        },
        {
          name: "cwd",
          display_name: "路径",
          data_type: "text",
          width: "260px",
          vertical_align: "top",
          horizontal_align: "left",
        },
        {
          name: "seen",
          display_name: "最近",
          data_type: "text",
          width: "80px",
          vertical_align: "top",
          horizontal_align: "left",
        },
      ],
      rows: visibleProjects.map((project) => ({
        alias: compactText(project.remark?.trim() || path.basename(project.cwd), 18),
        source: projectSourceLabel(project, defaultCwd, allowedCwds),
        cwd: compactText(project.cwd, 38),
        seen: relativeTime(project.lastSeen),
      })),
    });
  }

  if (projects.length > TABLE_VISIBLE_COUNT) {
    elements.push({
      tag: "div",
      text: plainText(`还有 ${projects.length - TABLE_VISIBLE_COUNT} 个项目未显示，请到 Dashboard 项目页查看。`),
    });
  }
  elements.push({
    tag: "div",
    text: plainText("用法：/new <项目别名或备注> <prompt> · /new <prompt>"),
  });

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: "grey",
      title: {
        tag: "plain_text",
        content: "项目列表",
      },
    },
    elements,
  };
};

const shortSessionId = (sessionId: string): string => sessionId.slice(0, 8);

const sessionProjectName = (session: SessionSummary): string =>
  session.remark?.trim() ||
  (session.cwd ? path.basename(session.cwd) : "unknown");

const sessionTitle = (session: SessionSummary): string =>
  session.title?.trim() || session.lastEventName || "无标题";

const sessionItemTitleText = (session: SessionSummary): string =>
  session.title?.trim() || shortSessionId(session.sessionId);

const sessionLastEventText = (session: SessionSummary): string =>
  session.lastEventName?.trim() || "—";

const sessionLastReplyText = (session: SessionSummary): string | null => {
  const value = session.lastAssistantMessage?.trim();
  return value ? value : null;
};

const compactText = (value: string, max: number): string =>
  truncateText(value.replace(/\s+/g, " ").trim(), max);

const SESSION_LIST_VISIBLE_COUNT = 10;

const plainText = (content: string): Record<string, string> => ({
  tag: "plain_text",
  content,
});

const sessionSummaryText = (session: SessionSummary): string => {
  const lastReply = sessionLastReplyText(session);
  return lastReply
    ? compactText(lastReply, 10)
    : compactText(sessionLastEventText(session), 16);
};

const normalizeSessionTarget = (target: string): string =>
  target.trim().replace(/^#/, "").replace(/^session[:：]?/i, "");

const listLocalSessions = (filter?: string): SessionSummary[] => {
  const needle = filter?.trim().toLowerCase();
  return recentSessions(undefined, 200)
    .filter((session) => {
      if (!needle) return true;
      return [
        session.sessionId,
        shortSessionId(session.sessionId),
        session.cwd ?? "",
        session.remark ?? "",
        path.basename(session.cwd ?? ""),
        session.title ?? "",
      ].some((item) => item.toLowerCase().includes(needle));
    })
    .slice(0, 30);
};

const resolveLocalSession = (
  target: string,
): { session: SessionSummary | null; error: string | null } => {
  const value = normalizeSessionTarget(target);
  if (!value) return { session: null, error: "sessionId 不能为空" };
  const sessions = recentSessions(undefined, 200);
  const exact = sessions.find((session) => session.sessionId === value);
  if (exact) return { session: exact, error: null };
  const prefixMatches = sessions.filter(
    (session) =>
      session.sessionId.startsWith(value) ||
      shortSessionId(session.sessionId) === value,
  );
  if (prefixMatches.length === 1) {
    return { session: prefixMatches[0], error: null };
  }
  if (prefixMatches.length > 1) {
    return {
      session: null,
      error: `session 前缀不唯一：${value}\n${prefixMatches
        .slice(0, 5)
        .map((session) => `- ${shortSessionId(session.sessionId)} · ${sessionProjectName(session)} · ${sessionTitle(session)}`)
        .join("\n")}`,
    };
  }
  return { session: null, error: `找不到本地 Claude session：${target}` };
};

interface FeishuContext {
  botId: string;
  chatId: string;
  senderId: string | null;
  sourceThreadId: string;
}

const attachLocalSessionToFeishu = (
  target: string,
  context: FeishuContext,
): { thread: RemoteThread | null; session: SessionSummary | null; error: string | null } => {
  const resolved = resolveLocalSession(target);
  if (!resolved.session) {
    return { thread: null, session: null, error: resolved.error };
  }
  const session = resolved.session;
  const cwd = session.cwd ?? defaultCwdForBot(context.botId);
  if (!cwd) {
    return {
      thread: null,
      session,
      error: `本地 session ${shortSessionId(session.sessionId)} 缺少 cwd，无法在 CLI 模式续上。`,
    };
  }
  const thread = attachRemoteSession({
    source: "feishu",
    cwd,
    claudeSessionId: session.sessionId,
    title: session.title ?? `本地会话 ${shortSessionId(session.sessionId)}`,
    sourceThreadId: context.sourceThreadId,
    sourceChatId: context.chatId,
    sourceUserId: context.senderId,
    sourceBotId: context.botId,
  });
  return { thread, session, error: null };
};

const buildSessionsText = (filter?: string): string => {
  const sessions = listLocalSessions(filter);
  const lines = [
    filter?.trim()
      ? `最近本地 Claude 会话 · ${filter.trim()}`
      : "最近本地 Claude 会话",
  ];
  if (sessions.length === 0) {
    lines.push("暂无可用本地会话。先在本机 Claude Code 里产生 hook 记录。");
    return lines.join("\n");
  }
  for (const session of sessions.slice(0, SESSION_LIST_VISIBLE_COUNT)) {
    lines.push([
      `${shortSessionId(session.sessionId)} · ${sessionProjectName(session)} · ${relativeTime(session.lastEventAt)}`,
      compactText(sessionItemTitleText(session), 22),
      sessionSummaryText(session),
    ].join(" · "));
  }
  if (sessions.length > SESSION_LIST_VISIBLE_COUNT) {
    lines.push(`还有 ${sessions.length - SESSION_LIST_VISIBLE_COUNT} 个会话未显示，可用 /sessions <项目> 过滤。`);
  }
  lines.push("");
  lines.push("用法：/use-session <session前缀> 绑定后，普通消息会继续这个本地会话。");
  lines.push("也可以：/continue-session <session前缀> <任务>");
  return lines.join("\n");
};

const buildSessionsCard = (filter?: string): Record<string, unknown> => {
  const sessions = listLocalSessions(filter);
  const title = filter?.trim()
    ? `最近本地 Claude 会话 · ${filter.trim()}`
    : "最近本地 Claude 会话";
  const visibleSessions = sessions.slice(0, SESSION_LIST_VISIBLE_COUNT);
  const elements: Array<Record<string, unknown>> = [];

  if (sessions.length === 0) {
    elements.push({
      tag: "div",
      text: plainText("暂无可用本地会话。先在本机 Claude Code 里产生 hook 记录。"),
    });
  } else {
    elements.push({
      tag: "table",
      page_size: SESSION_LIST_VISIBLE_COUNT,
      row_height: "low",
      freeze_first_column: true,
      header_style: {
        text_align: "left",
        text_size: "normal",
        background_style: "none",
        text_color: "grey",
        bold: true,
        lines: 1,
      },
      columns: [
        {
          name: "sid",
          display_name: "会话",
          data_type: "text",
          width: "90px",
          vertical_align: "top",
          horizontal_align: "left",
        },
        {
          name: "project",
          display_name: "项目",
          data_type: "text",
          width: "110px",
          vertical_align: "top",
          horizontal_align: "left",
        },
        {
          name: "time",
          display_name: "时间",
          data_type: "text",
          width: "80px",
          vertical_align: "top",
          horizontal_align: "left",
        },
        {
          name: "title",
          display_name: "标题",
          data_type: "text",
          width: "180px",
          vertical_align: "top",
          horizontal_align: "left",
        },
        {
          name: "summary",
          display_name: "最后回复",
          data_type: "text",
          width: "150px",
          vertical_align: "top",
          horizontal_align: "left",
        },
      ],
      rows: visibleSessions.map((session) => ({
        sid: shortSessionId(session.sessionId),
        project: sessionProjectName(session),
        time: relativeTime(session.lastEventAt),
        title: compactText(sessionItemTitleText(session), 22),
        summary: sessionSummaryText(session),
      })),
    });
  }

  if (sessions.length > SESSION_LIST_VISIBLE_COUNT) {
    elements.push({
      tag: "div",
      text: plainText(
        `还有 ${sessions.length - SESSION_LIST_VISIBLE_COUNT} 个会话未显示，可用 /sessions <项目> 过滤。`,
      ),
    });
  }
  elements.push({
    tag: "div",
    text: plainText("用法：/use-session <session前缀> · /continue-session <session前缀> <任务>"),
  });

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: "grey",
      title: {
        tag: "plain_text",
        content: title,
      },
    },
    elements,
  };
};

const buildUseSessionText = (
  target: string,
  context: FeishuContext,
): string => {
  const result = attachLocalSessionToFeishu(target, context);
  if (!result.thread || !result.session) {
    return result.error ?? `无法绑定本地 session：${target}`;
  }
  return [
    `已绑定本地 Claude 会话：${shortSessionId(result.session.sessionId)}`,
    `当前远程对话：#${result.thread.shortId}`,
    `项目：${sessionProjectName(result.session)}`,
    "后续普通消息会继续这个本地会话。",
  ].join("\n");
};

const isThreadVisibleToSource = (
  thread: RemoteThread,
  context: Pick<FeishuContext, "botId" | "chatId" | "senderId">,
): boolean => {
  if (thread.source !== "feishu") return false;
  if (thread.sourceBotId && thread.sourceBotId !== context.botId) return false;
  if (thread.sourceChatId && thread.sourceChatId !== context.chatId) return false;
  if (thread.sourceUserId && thread.sourceUserId !== context.senderId) return false;
  return true;
};

const findActiveThreadForSource = (context: FeishuContext): RemoteThread | null => {
  const exact = findLatestRemoteThreadForSource({
    source: "feishu",
    sourceBotId: context.botId,
    sourceThreadId: context.sourceThreadId,
    sourceChatId: context.chatId,
    sourceUserId: context.senderId,
  });
  if (exact) return exact;
  return findLatestRemoteThreadForSource({
    source: "feishu",
    sourceBotId: context.botId,
    sourceChatId: context.chatId,
    sourceUserId: context.senderId,
  });
};

const findVisibleThreadByTarget = (
  target: string,
  context: Pick<FeishuContext, "botId" | "chatId" | "senderId">,
): RemoteThread | null => {
  const thread = getRemoteThread(normalizeThreadTarget(target));
  if (!thread || !isThreadVisibleToSource(thread, context)) return null;
  return thread;
};

const listVisibleThreads = (
  context: Pick<FeishuContext, "botId" | "chatId" | "senderId">,
  limit = 10,
): RemoteThread[] =>
  queryRemoteThreads({ source: "feishu", limit: 80 }).threads
    .filter((thread) => isThreadVisibleToSource(thread, context))
    .slice(0, limit);

const buildThreadDetailText = (thread: RemoteThread): string => {
  const messages = queryRemoteMessages({ threadId: thread.id, limit: 80 }).messages;
  const recent = messages.slice(-5);
  const lines = [
    `远程对话 #${thread.shortId}`,
    `状态：${thread.status}`,
    `项目：${thread.cwd ? path.basename(thread.cwd) : "unknown"}`,
    `路径：${thread.cwd ?? "unknown"}`,
    `Session：${thread.claudeSessionId ?? "暂无"}`,
    `最近更新：${relativeTime(thread.updatedAt)}`,
  ];
  if (thread.title) lines.push(`标题：${thread.title}`);
  if (recent.length > 0) {
    lines.push("", "最近消息：");
    for (const message of recent) {
      const direction =
        message.direction === "inbound"
          ? "用户"
          : message.direction === "outbound"
            ? "Claude"
            : message.direction;
      lines.push(
        `${direction}：${truncateText(message.text.replace(/\s+/g, " "), 80)}`,
      );
    }
  }
  return lines.join("\n");
};

const buildStatusText = (context: FeishuContext & { target?: string }): string => {
  if (context.target) {
    const thread = findVisibleThreadByTarget(context.target, context);
    return thread
      ? [
          buildThreadDetailText(thread),
          "",
          ...buildFeishuStatusContextLines({
            senderId: context.senderId,
            chatId: context.chatId,
            sourceThreadId: context.sourceThreadId,
            remoteThreadId: thread.id,
            remoteThreadShortId: thread.shortId,
          }),
        ].join("\n")
      : `找不到远程对话：${context.target}`;
  }
  const cfg = readConfig().remoteBridge;
  const active = findActiveThreadForSource(context);
  const instances = queryRemoteChannelInstances({ limit: 5 });
  const recent = listVisibleThreads(context, 5);
  const lines = [
    "远程状态",
    `Bridge：${cfg?.enabled ? "已启用" : "未启用"} · ${cfg?.deliveryMode ?? "cli"}`,
    `在线 channel：${instances.length}`,
    active ? `当前默认：${formatThreadLine(active)}` : "当前默认：暂无",
  ];
  lines.push(
    "",
    ...buildFeishuStatusContextLines({
      senderId: context.senderId,
      chatId: context.chatId,
      sourceThreadId: context.sourceThreadId,
      remoteThreadId: active?.id,
      remoteThreadShortId: active?.shortId,
    }),
  );
  if (recent.length > 0) {
    lines.push("");
    lines.push("最近对话：");
    for (const thread of recent) lines.push(formatThreadLine(thread));
  }
  return lines.join("\n");
};

const parseThreadStatusFilter = (filter: string | undefined): RemoteThread["status"] | null => {
  const normalized = filter?.trim().toLowerCase();
  const validStatuses = new Set<RemoteThread["status"]>([
    "pending",
    "queued",
    "running",
    "waiting_permission",
    "done",
    "failed",
  ]);
  return normalized && validStatuses.has(normalized as RemoteThread["status"])
    ? (normalized as RemoteThread["status"])
    : null;
};

const listThreadsForDisplay = (
  filter: string | undefined,
  context: Pick<FeishuContext, "botId" | "chatId" | "senderId">,
  limit = 30,
): { statusFilter: RemoteThread["status"] | null; threads: RemoteThread[] } => {
  const statusFilter = parseThreadStatusFilter(filter);
  const threads = listVisibleThreads(context, limit).filter((thread) =>
    statusFilter ? thread.status === statusFilter : true,
  );
  return { statusFilter, threads };
};

const buildThreadsText = (
  filter: string | undefined,
  context: Pick<FeishuContext, "botId" | "chatId" | "senderId">,
): string => {
  const { statusFilter, threads } = listThreadsForDisplay(filter, context, 30);
  const lines = [
    statusFilter ? `最近远程对话 · ${threadStatusLabel(statusFilter)}` : "最近远程对话",
  ];
  if (threads.length === 0) {
    lines.push("暂无可见远程对话。用 /new <项目> <任务> 新建一个。");
    return lines.join("\n");
  }
  for (const thread of threads.slice(0, TABLE_VISIBLE_COUNT)) {
    lines.push(`${formatThreadLine(thread)} · ${relativeTime(thread.updatedAt)}`);
  }
  if (threads.length > TABLE_VISIBLE_COUNT) {
    lines.push(`还有 ${threads.length - TABLE_VISIBLE_COUNT} 个对话未显示，可用 /threads <状态> 过滤。`);
  }
  lines.push("", "用法：/use <threadId> 切换默认对话，/show <threadId> 查看详情。");
  return lines.join("\n");
};

const buildThreadsCard = (
  filter: string | undefined,
  context: Pick<FeishuContext, "botId" | "chatId" | "senderId">,
): Record<string, unknown> => {
  const { statusFilter, threads } = listThreadsForDisplay(filter, context, 30);
  const visibleThreads = threads.slice(0, TABLE_VISIBLE_COUNT);
  const elements: Array<Record<string, unknown>> = [];

  if (threads.length === 0) {
    elements.push({
      tag: "div",
      text: plainText("暂无可见远程对话。用 /new <项目> <任务> 新建一个。"),
    });
  } else {
    elements.push({
      tag: "table",
      page_size: TABLE_VISIBLE_COUNT,
      row_height: "low",
      freeze_first_column: true,
      header_style: {
        text_align: "left",
        text_size: "normal",
        background_style: "none",
        text_color: "grey",
        bold: true,
        lines: 1,
      },
      columns: [
        {
          name: "thread",
          display_name: "对话",
          data_type: "text",
          width: "90px",
          vertical_align: "top",
          horizontal_align: "left",
        },
        {
          name: "status",
          display_name: "状态",
          data_type: "text",
          width: "80px",
          vertical_align: "top",
          horizontal_align: "left",
        },
        {
          name: "project",
          display_name: "项目",
          data_type: "text",
          width: "120px",
          vertical_align: "top",
          horizontal_align: "left",
        },
        {
          name: "updated",
          display_name: "更新",
          data_type: "text",
          width: "80px",
          vertical_align: "top",
          horizontal_align: "left",
        },
        {
          name: "title",
          display_name: "标题",
          data_type: "text",
          width: "220px",
          vertical_align: "top",
          horizontal_align: "left",
        },
      ],
      rows: visibleThreads.map((thread) => ({
        thread: `#${thread.shortId}`,
        status: threadStatusLabel(thread.status),
        project: thread.cwd ? compactText(path.basename(thread.cwd), 16) : "unknown",
        updated: relativeTime(thread.updatedAt),
        title: compactText(
          thread.title?.trim() || thread.cwd || thread.id,
          28,
        ),
      })),
    });
  }

  if (threads.length > TABLE_VISIBLE_COUNT) {
    elements.push({
      tag: "div",
      text: plainText(`还有 ${threads.length - TABLE_VISIBLE_COUNT} 个对话未显示，可用 /threads <状态> 过滤。`),
    });
  }
  elements.push({
    tag: "div",
    text: plainText("用法：/use <threadId> 切换默认对话 · /show <threadId> 查看详情"),
  });

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: "grey",
      title: {
        tag: "plain_text",
        content: statusFilter
          ? `最近远程对话 · ${threadStatusLabel(statusFilter)}`
          : "最近远程对话",
      },
    },
    elements,
  };
};

const buildUseThreadText = (
  target: string,
  context: FeishuContext,
): string => {
  const thread = findVisibleThreadByTarget(target, context);
  if (!thread) {
    return `找不到可切换的远程对话：${target}`;
  }
  const updated = updateRemoteThread(thread.id, {
    sourceThreadId: context.sourceThreadId,
    sourceChatId: context.chatId,
    sourceUserId: context.senderId,
    sourceBotId: context.botId,
  });
  return `已切换当前聊天默认对话：${formatThreadLine(updated ?? thread)}`;
};

const buildShowThreadText = (
  target: string,
  context: Pick<FeishuContext, "botId" | "chatId" | "senderId">,
): string => {
  const thread = findVisibleThreadByTarget(target, context);
  return thread ? buildThreadDetailText(thread) : `找不到远程对话：${target}`;
};

const buildStopThreadText = (
  target: string | undefined,
  context: FeishuContext,
): string => {
  const thread = target
    ? findVisibleThreadByTarget(target, context)
    : findActiveThreadForSource(context);
  if (!thread) {
    return target
      ? `找不到可停止的远程对话：${target}`
      : "当前聊天没有默认远程对话。先用 /threads 查看，或用 /use <threadId> 切换。";
  }
  const result = stopRemoteThread(thread.id);
  return result.message;
};

const buildUnknownCommandText = (name: string): string =>
  [
    `未知远程命令：/${name}`,
    "可用命令：/help、/new、/continue、/use、/status、/projects、/threads、/sessions、/use-session、/continue-session、/show、/stop",
    "如果想把斜杠内容原样发给 Claude，可以先用普通文字说明，例如：请处理这个命令文本：/xxx",
  ].join("\n");

const commandToDirectReply = (
  command: FeishuRemoteCommand,
  context: FeishuContext,
): string | null => {
  switch (command.kind) {
    case "help":
      return buildHelpText();
    case "projects":
      return buildProjectsText(context.botId);
    case "sessions":
      return buildSessionsText(command.filter);
    case "useSession":
      return buildUseSessionText(command.target, context);
    case "status":
      return buildStatusText({ ...context, target: command.target });
    case "threads":
      return buildThreadsText(command.filter, context);
    case "show":
      return buildShowThreadText(command.target, context);
    case "stop":
      return buildStopThreadText(command.target, context);
    case "use":
      return buildUseThreadText(command.target, context);
    case "unknown":
      return buildUnknownCommandText(command.name);
    case "new":
    case "continue":
    case "continueSession":
      return null;
  }
};

const sendFeishuText = async (
  botId: string | null | undefined,
  chatId: string,
  text: string,
): Promise<void> => {
  const runtime = runtimeForBot(botId);
  if (!runtime) return;
  const content = JSON.stringify({ text });
  await runtime.client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "text",
      content,
    },
  });
};

export const sendFeishuFileToThread = async (input: {
  thread: RemoteThread;
  filePath: string;
  fileName?: string | null;
  text?: string | null;
}): Promise<{ fileKey: string; messageId: string | null }> => {
  if (runtimes.size === 0) startFeishuRemoteBridge();
  const runtime = runtimeForBot(input.thread.sourceBotId);
  if (!runtime) throw new Error("飞书自建应用未启用或缺少 appId/appSecret");
  if (input.thread.source !== "feishu" || !input.thread.sourceChatId) {
    throw new Error("remote thread is not a Feishu conversation");
  }

  const note = input.text?.trim();
  if (note) {
    await sendFeishuText(
      runtime.bot.id,
      input.thread.sourceChatId,
      note,
    );
  }

  const uploadResult = await runtime.client.im.v1.file.create({
    data: {
      file_type: "stream",
      file_name: input.fileName?.trim() || path.basename(input.filePath),
      file: fs.createReadStream(input.filePath),
    },
  });
  const uploaded = uploadResult as
    | { file_key?: string; data?: { file_key?: string } }
    | null;
  const fileKey = uploaded?.file_key ?? uploaded?.data?.file_key;
  if (!fileKey) throw new Error("Feishu upload succeeded without file_key");

  const result = await runtime.client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: input.thread.sourceChatId,
      msg_type: "file",
      content: JSON.stringify({ file_key: fileKey }),
    },
  });
  assertFeishuOk(result, "send file message");
  return {
    fileKey,
    messageId: result.data?.message_id ?? null,
  };
};

const assertFeishuOk = (
  result: { code?: number; msg?: string },
  action: string,
): void => {
  if (typeof result.code === "number" && result.code !== 0) {
    throw new Error(`${action} failed: ${result.msg ?? result.code}`);
  }
};

const describeFeishuError = (err: unknown): string => {
  if (!err || typeof err !== "object") {
    return err instanceof Error ? err.message : String(err);
  }
  const record = err as {
    message?: unknown;
    response?: { status?: unknown; data?: unknown };
    code?: unknown;
  };
  const status =
    typeof record.response?.status === "number"
      ? `status ${record.response.status}`
      : null;
  const data = record.response?.data;
  const detail =
    typeof data === "string"
      ? data
      : data
        ? JSON.stringify(data)
        : typeof record.message === "string"
          ? record.message
          : String(err);
  return [status, detail].filter(Boolean).join(": ");
};

const sendFeishuCard = async (input: {
  botId?: string | null;
  chatId: string;
  card: Record<string, unknown>;
  action?: string;
}): Promise<string | null> => {
  const runtime = runtimeForBot(input.botId);
  if (!runtime) return null;
  const content = JSON.stringify(input.card);
  const result = await runtime.client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: input.chatId,
      msg_type: "interactive",
      content,
    },
  });
  assertFeishuOk(result, input.action ?? "send card");
  return result.data?.message_id ?? null;
};

const sendCommandCard = async (input: {
  botId: string | null | undefined;
  chatId: string;
  card: Record<string, unknown>;
  fallbackText: string;
  action: string;
}): Promise<void> => {
  try {
    await sendFeishuCard({
      botId: input.botId,
      chatId: input.chatId,
      card: input.card,
      action: input.action,
    });
  } catch (err) {
    console.warn(`[feishu] ${input.action} failed: ${describeFeishuError(err)}`);
    await sendFeishuText(input.botId, input.chatId, input.fallbackText);
  }
};

const sendProjectsCard = async (
  botId: string | null | undefined,
  chatId: string,
): Promise<void> =>
  sendCommandCard({
    botId,
    chatId,
    card: buildProjectsCard(botId ?? undefined),
    fallbackText: buildProjectsText(botId ?? undefined),
    action: "send projects card",
  });

const sendSessionsCard = async (
  botId: string | null | undefined,
  chatId: string,
  filter?: string,
): Promise<void> =>
  sendCommandCard({
    botId,
    chatId,
    card: buildSessionsCard(filter),
    fallbackText: buildSessionsText(filter),
    action: "send sessions card",
  });

const sendThreadsCard = async (
  botId: string | null | undefined,
  chatId: string,
  context: Pick<FeishuContext, "botId" | "chatId" | "senderId">,
  filter?: string,
): Promise<void> =>
  sendCommandCard({
    botId,
    chatId,
    card: buildThreadsCard(filter, context),
    fallbackText: buildThreadsText(filter, context),
    action: "send threads card",
  });

const patchFeishuCard = async (
  botId: string | null | undefined,
  providerMessageId: string,
  card: Record<string, unknown>,
): Promise<void> => {
  const runtime = runtimeForBot(botId);
  if (!runtime) return;
  const result = await runtime.client.im.v1.message.patch({
    path: { message_id: providerMessageId },
    data: { content: JSON.stringify(card) },
  });
  assertFeishuOk(result, "patch progress card");
};

const msUntilNextPatch = (
  card: RemoteMessageCard,
): number => {
  if (!card.lastPatchedAt) return 0;
  return Math.max(0, PATCH_MIN_INTERVAL_MS - (Date.now() - Date.parse(card.lastPatchedAt)));
};

const clearScheduledCardPatch = (cardId: string): void => {
  const timer = cardPatchTimers.get(cardId);
  if (!timer) return;
  clearTimeout(timer);
  cardPatchTimers.delete(cardId);
};

const scheduleTrailingCardPatch = (cardId: string, delayMs: number): void => {
  if (cardPatchTimers.has(cardId)) return;
  const timer = setTimeout(() => {
    cardPatchTimers.delete(cardId);
    const latest = updateRemoteMessageCard(cardId, {});
    const snapshot = latest?.lastSnapshot as RemoteProgressSnapshot | null | undefined;
    if (!latest || !snapshot) return;
    void patchStoredProgressCard(latest, snapshot, true);
  }, Math.max(0, delayMs));
  cardPatchTimers.set(cardId, timer);
};

const enqueueCardPatch = (
  cardId: string,
  task: () => Promise<RemoteMessageCard | null>,
): Promise<RemoteMessageCard | null> => {
  const previous = cardPatchQueues.get(cardId) ?? Promise.resolve(null);
  const next = previous
    .catch(() => null)
    .then(task)
    .finally(() => {
      if (cardPatchQueues.get(cardId) === next) {
        cardPatchQueues.delete(cardId);
      }
    });
  cardPatchQueues.set(cardId, next);
  return next;
};

const patchStoredProgressCard = async (
  card: RemoteMessageCard,
  snapshot: RemoteProgressSnapshot,
  force = false,
): Promise<RemoteMessageCard | null> => {
  const stored = updateRemoteMessageCard(card.id, {
    status: snapshot.status,
    lastSnapshot: snapshot,
  });
  const current = stored ?? card;
  if (current.error && !force) {
    return current;
  }
  if (!current.providerMessageId) {
    return current;
  }
  if (force) {
    clearScheduledCardPatch(current.id);
  }
  if (cardPatchQueues.has(current.id) && !force) {
    scheduleTrailingCardPatch(current.id, PATCH_MIN_INTERVAL_MS);
    return current;
  }
  const waitBeforePatch = msUntilNextPatch(current);
  if (!force && waitBeforePatch > 0) {
    scheduleTrailingCardPatch(current.id, waitBeforePatch);
    return current;
  }

  return enqueueCardPatch(current.id, async () => {
    let latest = updateRemoteMessageCard(current.id, {}) ?? current;
    if (latest.error && !force) {
      return latest;
    }
    if (!latest.providerMessageId) {
      return latest;
    }
    const waitMs = msUntilNextPatch(latest);
    if (waitMs > 0) {
      if (!force) {
        scheduleTrailingCardPatch(latest.id, waitMs);
        return latest;
      }
      await sleep(waitMs);
      latest = updateRemoteMessageCard(current.id, {}) ?? latest;
      if (!latest.providerMessageId) return latest;
    }

    try {
      await patchFeishuCard(
        latest.sourceBotId,
        latest.providerMessageId,
        buildFeishuProgressCard(snapshot, progressCardConfig(latest.sourceBotId)),
      );
      const updated = updateRemoteMessageCard(latest.id, {
        status: snapshot.status,
        lastSnapshot: snapshot,
        lastPatchedAt: new Date().toISOString(),
        error: null,
      });
      cardPatchFailureNotified.delete(latest.id);
      return updated;
    } catch (err) {
      const error = describeFeishuError(err);
      const failed = updateRemoteMessageCard(latest.id, { error });
      if (!cardPatchFailureNotified.has(latest.id) && !latest.error && latest.chatId) {
        cardPatchFailureNotified.add(latest.id);
        await sendFeishuText(
          latest.sourceBotId,
          latest.chatId,
          `进度卡片更新失败，后续将降级为文本：${error}`,
        );
      }
      return failed;
    }
  });
};

const sendFinalReplyText = async (
  botId: string | null | undefined,
  chatId: string,
  thread: RemoteThread,
  text: string,
): Promise<void> => {
  const chunks = splitFeishuText(text);
  if (chunks.length === 0) return;
  for (let i = 0; i < chunks.length; i += 1) {
    const body =
      chunks.length > 1
        ? `#${thread.shortId} 回复 ${i + 1}/${chunks.length}\n${chunks[i]}`
        : chunks[i];
    await sendFeishuText(botId, chatId, body);
  }
};

const createProgressCardForInbound = async (input: {
  thread: RemoteThread;
  message: RemoteMessage;
  botId: string | null;
  chatId: string;
}): Promise<void> => {
  if (!progressCardConfig(input.botId).enabled) return;
  if (getRemoteMessageCardByInbound(input.message.id)) return;
  const ts = new Date().toISOString();
  const snapshot =
    getRemoteProgressSnapshot(input.message.id) ??
    ({
      threadId: input.thread.id,
      shortId: input.thread.shortId,
      inboundMessageId: input.message.id,
      source: input.thread.source,
      cwd: input.thread.cwd,
      project: input.thread.cwd ? path.basename(input.thread.cwd) : "unknown",
      prompt: input.message.text,
      status: "queued",
      phase: "已接收，等待执行",
      events: ["已接收远程消息"],
      tools: [],
      answerPreview: "",
      finalText: "",
      error: null,
      startedAt: ts,
      updatedAt: ts,
      elapsedMs: 0,
    } satisfies RemoteProgressSnapshot);

  let card = createRemoteMessageCard({
    threadId: input.thread.id,
    inboundMessageId: input.message.id,
    provider: "feishu",
    sourceBotId: input.botId,
    chatId: input.chatId,
    status: snapshot.status,
    lastSnapshot: snapshot,
  });

  try {
    const providerMessageId = await sendFeishuCard({
      botId: input.botId,
      chatId: input.chatId,
      card: buildFeishuProgressCard(snapshot, progressCardConfig(input.botId)),
    });
    card =
      updateRemoteMessageCard(card.id, {
        providerMessageId,
        status: snapshot.status,
        lastSnapshot: snapshot,
        lastPatchedAt: new Date().toISOString(),
        error: null,
      }) ?? card;
    const latest = getRemoteProgressSnapshot(input.message.id);
    if (latest) await patchStoredProgressCard(card, latest);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    updateRemoteMessageCard(card.id, { error, status: "failed" });
    await sendFeishuText(
      input.botId,
      input.chatId,
      `已开始执行，但进度卡片发送失败 · #${input.thread.shortId}\n${error}`,
    );
  }
};

const handleRemoteProgress = async (
  snapshot: RemoteProgressSnapshot,
): Promise<void> => {
  if (snapshot.source !== "feishu") return;
  const card = getRemoteMessageCardByInbound(snapshot.inboundMessageId);
  if (!card) return;
  if (!progressCardConfig(card.sourceBotId).enabled) return;
  await patchStoredProgressCard(card, snapshot);
};

const handleFeishuText = async (
  event: Record<string, any>,
  botId: string,
): Promise<void> => {
  const message = event.message ?? {};
  if (!shouldHandleGroupMessage(message)) return;

  const senderId = pickSenderId(event);
  const allowed = allowedUsersForBot(botId);
  if (allowed.length > 0 && (!senderId || !allowed.includes(senderId))) {
    return;
  }

  const chatId = message.chat_id as string | undefined;
  if (!chatId) return;

  let text = textWithoutBotMention(parseFeishuTextContent(message.content));
  if (!text) return;

  const permission = parsePermissionReply(text);
  if (permission) {
    try {
      submitPermissionVerdict({
        requestId: permission.requestId,
        behavior: permission.behavior,
        source: {
          source: "feishu",
          sourceBotId: botId,
          sourceChatId: chatId,
          sourceUserId: senderId,
        },
      });
      await sendFeishuText(
        botId,
        chatId,
        `已记录审批：${permission.behavior} ${permission.requestId}`,
      );
    } catch (err) {
      await sendFeishuText(
        botId,
        chatId,
        `审批处理失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  let mode: "new" | "continue" = "continue";
  let threadId: string | undefined;
  let cwd: string | null | undefined = defaultCwdForBot(botId);
  let claudeSessionId: string | null | undefined;

  const sourceThreadId =
    (message.root_id as string | undefined) ??
    (message.parent_id as string | undefined) ??
    chatId;
  const context: FeishuContext = {
    botId,
    chatId,
    senderId,
    sourceThreadId,
  };

  const command = parseFeishuRemoteCommand(text);
  if (command) {
    if (command.kind === "projects") {
      await sendProjectsCard(botId, chatId);
      return;
    }
    if (command.kind === "sessions") {
      await sendSessionsCard(botId, chatId, command.filter);
      return;
    }
    if (command.kind === "threads") {
      await sendThreadsCard(botId, chatId, context, command.filter);
      return;
    }
    const reply = commandToDirectReply(command, context);
    if (reply) {
      await sendFeishuText(botId, chatId, reply);
      return;
    }
    if (command.kind === "new") {
      const resolved = resolveNewCommandInput(command.input, botId);
      mode = "new";
      cwd = resolved.cwd;
      text = resolved.text;
    } else if (command.kind === "continue") {
      mode = "continue";
      threadId = command.threadId;
      text = command.prompt;
    } else if (command.kind === "continueSession") {
      const attached = attachLocalSessionToFeishu(command.target, context);
      if (!attached.thread || !attached.session) {
        await sendFeishuText(
          botId,
          chatId,
          attached.error ?? `无法继续本地 session：${command.target}`,
        );
        return;
      }
      mode = "continue";
      threadId = attached.thread.id;
      cwd = attached.thread.cwd;
      claudeSessionId = attached.session.sessionId;
      text = command.prompt;
    }
  }

  let result: ReturnType<typeof sendRemoteMessage>;
  try {
    result = sendRemoteMessage({
      source: "feishu",
      sourceBotId: botId,
      mode,
      threadId,
      cwd,
      claudeSessionId,
      text,
      sourceThreadId,
      sourceChatId: chatId,
      sourceUserId: senderId,
      sourceMessageId: message.message_id,
      raw: event,
    });
  } catch (err) {
    await sendFeishuText(
      botId,
      chatId,
      `远程消息发送失败：${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  if (progressCardConfig(botId).enabled) {
    await createProgressCardForInbound({
      thread: result.thread,
      message: result.message,
      botId,
      chatId,
    });
    return;
  }

  await sendFeishuText(
    botId,
    chatId,
    result.dispatched
      ? `已开始执行，等待 Claude 回复 · #${result.thread.shortId}`
      : `已排队，等待 Claude Code 可用 · #${result.thread.shortId}`,
  );
};

const sendOutboundToFeishu = async (
  thread: RemoteThread,
  message: RemoteMessage,
  kind: RemoteOutboundKind,
): Promise<void> => {
  if (thread.source !== "feishu" || !thread.sourceChatId) return;
  if (kind === "partial") return;
  let finalTextSent = false;
  const sendFinalTextOnce = async (): Promise<void> => {
    if (finalTextSent) return;
    finalTextSent = true;
    await sendFinalReplyText(
      thread.sourceBotId,
      thread.sourceChatId ?? "",
      thread,
      message.text,
    );
  };

  if (progressCardConfig(thread.sourceBotId).enabled) {
    const card = getLatestRemoteMessageCardForThread(thread.id);
    if (card?.providerMessageId) {
      const baseSnapshot =
        (card.lastSnapshot as RemoteProgressSnapshot | null) ??
        getRemoteProgressSnapshot(card.inboundMessageId);
      if (baseSnapshot) {
        if (kind === "error") {
          await sendFinalTextOnce();
          await patchStoredProgressCard(
            card,
            markProgressFailed(baseSnapshot, message.text),
            true,
          );
          return;
        }
        await sendFinalTextOnce();
        await patchStoredProgressCard(
          card,
          markProgressDone(baseSnapshot, message.text),
          true,
        );
        return;
      }
    }
  }
  await sendFinalTextOnce();
};

export const startFeishuRemoteBridge = (): void => {
  const config = readConfig().remoteBridge;
  const feishu = config?.feishu;
  if (!config?.enabled || !feishu?.enabled) {
    return;
  }
  if (runtimes.size > 0) return;

  const bots = activeFeishuBots();
  if (bots.length === 0) return;

  for (const bot of bots) {
    const client = new lark.Client({
      appId: bot.appId,
      appSecret: bot.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
      loggerLevel: lark.LoggerLevel.warn,
    });

    const eventDispatcher = new lark.EventDispatcher({
      encryptKey: bot.encryptKey,
      verificationToken: bot.verificationToken,
      loggerLevel: lark.LoggerLevel.warn,
    }).register({
      "im.message.receive_v1": async (data: unknown) => {
        await handleFeishuText(data as Record<string, any>, bot.id);
      },
    });

    const wsClient = new lark.WSClient({
      appId: bot.appId,
      appSecret: bot.appSecret,
      domain: lark.Domain.Feishu,
      loggerLevel: lark.LoggerLevel.warn,
    });
    wsClient?.start({ eventDispatcher });
    runtimes.set(bot.id, { bot, client, wsClient });
  }

  unregisterSender = registerRemoteOutboundSender(sendOutboundToFeishu);
  unregisterProgress = onRemoteEvent((kind, data) => {
    if (kind !== "progress") return;
    void handleRemoteProgress(data as RemoteProgressSnapshot);
  });
  if (process.env.CLAUDE_PROXY_VERBOSE === "1") {
    console.log(`[remote:feishu] ${bots.length} long connection(s) started`);
  }
};

export const stopFeishuRemoteBridge = (): void => {
  for (const runtime of runtimes.values()) {
    try {
      runtime.wsClient?.stop?.();
    } catch {
      // ignore
    }
  }
  runtimes = new Map();
  unregisterSender?.();
  unregisterSender = null;
  unregisterProgress?.();
  unregisterProgress = null;
};

export const restartFeishuRemoteBridge = (): void => {
  stopFeishuRemoteBridge();
  startFeishuRemoteBridge();
};

export const testFeishuApp = async (
  botId?: string,
  chatId?: string,
): Promise<void> => {
  if (runtimes.size === 0) startFeishuRemoteBridge();
  const runtime = runtimeForBot(botId);
  if (!runtime) throw new Error("飞书自建应用未启用或缺少 appId/appSecret");
  if (chatId) {
    await sendFeishuText(
      runtime.bot.id,
      chatId,
      `Claude Code 飞书远程桥测试\n${new Date().toLocaleString()}`,
    );
  }
};
