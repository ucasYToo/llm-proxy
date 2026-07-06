import type { RemoteProgressSnapshot } from "./progress";

export interface FeishuProgressCardOptions {
  showPartialAnswer?: boolean;
  showToolEvents?: boolean;
}

const MAX_EVENTS = 5;
const MAX_PREVIEW = 2600;

const statusMeta: Record<
  RemoteProgressSnapshot["status"],
  { label: string; template: string }
> = {
  queued: { label: "排队中", template: "grey" },
  running: { label: "运行中", template: "blue" },
  waiting_permission: { label: "等待审批", template: "orange" },
  done: { label: "已完成", template: "green" },
  failed: { label: "失败", template: "red" },
};

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;

const mdEscape = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/`/g, "\\`");

const durationLabel = (elapsedMs: number): string => {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return "0s";
  const seconds = Math.round(elapsedMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
};

const textObj = (content: string) => ({
  tag: "lark_md",
  content,
});

export const shouldSendLongFeishuText = (text: string): boolean =>
  text.trim().length > MAX_PREVIEW;

export const splitFeishuText = (text: string, max = 3500): string[] => {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    chunks.push(rest.slice(0, max));
    rest = rest.slice(max);
  }
  if (rest) chunks.push(rest);
  return chunks;
};

export const buildFeishuProgressCard = (
  snapshot: RemoteProgressSnapshot,
  options: FeishuProgressCardOptions = {},
): Record<string, unknown> => {
  const meta = statusMeta[snapshot.status] ?? statusMeta.running;
  const showToolEvents = options.showToolEvents ?? true;
  const events = snapshot.events.slice(-MAX_EVENTS);
  const tools = snapshot.tools.slice(-8);
  const phase = snapshot.phase.trim();
  const statusText =
    phase && phase !== meta.label ? `${meta.label} · ${mdEscape(phase)}` : meta.label;

  const elements: Array<Record<string, unknown>> = [
    {
      tag: "div",
      text: textObj(
        [
          `**Thread** #${snapshot.shortId}`,
          `**项目** ${mdEscape(snapshot.project)}`,
          `**状态** ${statusText}`,
          `**耗时** ${durationLabel(snapshot.elapsedMs)}`,
        ].join("  ·  "),
      ),
    },
  ];

  if (showToolEvents && tools.length > 0) {
    elements.push({
      tag: "div",
      text: textObj(`**工具摘要**\n${tools.map((tool) => `\`${mdEscape(tool)}\``).join("  ")}`),
    });
  }

  if (events.length > 0) {
    elements.push({
      tag: "div",
      text: textObj(`**过程**\n${events.map((item) => `- ${mdEscape(item)}`).join("\n")}`),
    });
  }

  if (snapshot.error) {
    elements.push({
      tag: "div",
      text: textObj(`**错误**\n${mdEscape(truncate(snapshot.error, 1200))}`),
    });
  }

  if (snapshot.dashboardUrl) {
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          text: {
            tag: "plain_text",
            content: "打开 Dashboard",
          },
          type: "default",
          url: snapshot.dashboardUrl,
        },
      ],
    });
  }

  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      template: meta.template,
      title: {
        tag: "plain_text",
        content: `Claude Code · ${meta.label}`,
      },
    },
    elements,
  };
};
