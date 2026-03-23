/**
 * 通用格式化工具函数
 * 从 LogsTab.tsx 和 LogDetailPanel.tsx 中提取的可复用函数
 */

/** 文本截断 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

/** 智能时间格式化：今天只显示时间，昨天显示"昨天 HH:mm:ss"，更早显示"M/D HH:mm:ss" */
export function formatTime(timestamp: string | number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const timeStr = date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  if (dateDay.getTime() === today.getTime()) {
    return timeStr;
  } else if (dateDay.getTime() === yesterday.getTime()) {
    return `昨天 ${timeStr}`;
  } else {
    return `${date.getMonth() + 1}/${date.getDate()} ${timeStr}`;
  }
}

/** JSON 值格式化为可读字符串 */
export function formatValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "object") {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

/** HTTP 状态码对应的 CSS 类名 */
export function statusClass(status: number): string {
  if (status === 0) return "status-err";
  if (status >= 200 && status < 300) return "status-ok";
  return "status-err";
}
