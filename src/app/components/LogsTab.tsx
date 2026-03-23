"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Config, LogEntry } from "@/lib/types";
import LogDetailPanel from "./LogDetailPanel";

type Density = "compact" | "comfortable";
type StatusFilter = "all" | "success" | "error" | "pending" | "streaming" | "completed";
type MethodFilter = "all" | "POST" | "GET" | "PUT" | "DELETE" | "other";
type DurationFilter = "all" | "slow";

interface Props {
  config: Config;
}

// 文本截断函数
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

// 智能时间格式化
function formatTime(timestamp: string | number): string {
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

// 从 content 数组中提取多条文本（每条一行）
function extractContentLines(content: unknown[]): string[] {
  const lines: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || !item) continue;
    const i = item as Record<string, unknown>;
    switch (i.type) {
      case "text":
        if (typeof i.text === "string" && i.text.trim()) {
          lines.push(`[text] ${truncateText(i.text.trim(), 110)}`);
        }
        break;
      case "thinking":
        if (typeof i.thinking === "string" && i.thinking.trim()) {
          lines.push(`[thinking] ${truncateText(i.thinking.trim(), 110)}`);
        }
        break;
      case "tool_use":
        if (typeof i.name === "string") {
          lines.push(`[tool_use] ${i.name}`);
        }
        break;
      case "tool_result":
        if (typeof i.content === "string" && i.content.trim()) {
          lines.push(`[tool_result] ${truncateText(i.content.trim(), 110)}`);
        } else if (Array.isArray(i.content)) {
          const nested = extractContentLines(i.content);
          nested.forEach(line => lines.push(line.startsWith("[") ? line : `[tool_result] ${line}`));
        }
        break;
      case "image":
        lines.push("[image]");
        break;
      default:
        if (i.type && typeof i.type === "string") {
          const text = typeof i.text === "string" ? i.text : 
                       typeof i.content === "string" ? i.content : "";
          if (text.trim()) {
            lines.push(`[${i.type}] ${truncateText(text.trim(), 110)}`);
          } else {
            lines.push(`[${i.type}]`);
          }
        }
        break;
    }
  }
  return lines;
}

// 提取最后一条 message 的文本内容（返回多行）
function extractLastMessageLines(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.messages)) return [];
  const lastMsg = b.messages[b.messages.length - 1];
  if (!lastMsg || typeof lastMsg !== "object") return [];
  const msg = lastMsg as Record<string, unknown>;
  const content = msg.content;
  if (typeof content === "string") {
    return content.trim() ? [truncateText(content.trim(), 120)] : [];
  }
  if (Array.isArray(content)) {
    return extractContentLines(content);
  }
  return [];
}

// 提取响应体的 content（返回多行）
function extractResponseLines(responseBody: unknown): string[] {
  if (!responseBody) return [];
  if (typeof responseBody === "string") {
    return responseBody.trim() ? [truncateText(responseBody.trim(), 120)] : [];
  }
  if (typeof responseBody === "object") {
    const rb = responseBody as Record<string, unknown>;
    if (typeof rb.content === "string" && rb.content.trim()) {
      return [truncateText(rb.content.trim(), 120)];
    }
    if (Array.isArray(rb.content)) {
      return extractContentLines(rb.content);
    }
    if (Array.isArray(rb.choices) && rb.choices.length > 0) {
      const choice = rb.choices[0] as Record<string, unknown>;
      if (choice.message && typeof choice.message === "object") {
        const msg = choice.message as Record<string, unknown>;
        if (typeof msg.content === "string" && msg.content.trim()) {
          return [truncateText(msg.content.trim(), 120)];
        }
        if (Array.isArray(msg.content)) {
          return extractContentLines(msg.content);
        }
      }
    }
    if (Array.isArray(rb.choices) && rb.choices.length > 0) {
      const firstChoice = rb.choices[0] as Record<string, unknown>;
      if (firstChoice.delta && typeof firstChoice.delta === "object") {
        const delta = firstChoice.delta as Record<string, unknown>;
        if (typeof delta.content === "string" && delta.content.trim()) {
          return [truncateText(delta.content.trim(), 120)];
        }
      }
    }
  }
  return [];
}

export default function LogsTab({ config }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filterTarget, setFilterTarget] = useState("");
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [density, setDensity] = useState<Density>("comfortable");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [methodFilter, setMethodFilter] = useState<MethodFilter>("all");
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const limit = 20;

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  const fetchLogs = useCallback(async (showLoading = false) => {
    if (showLoading) setIsRefreshing(true);
    const params = new URLSearchParams({
      type: "logs",
      limit: String(limit),
      offset: String(offset),
    });
    if (filterTarget) params.set("targetId", filterTarget);
    try {
      const res = await fetch(`/api/query?${params}`);
      const data = (await res.json()) as { entries: LogEntry[]; total: number };
      setLogs(data.entries);
      setTotal(data.total);
      setLastRefresh(new Date());
    } finally {
      if (showLoading) setIsRefreshing(false);
    }
  }, [offset, filterTarget]);

  // Initial fetch and auto refresh
  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      void fetchLogs();
    }, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if typing in input/select
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      if (e.key === "Escape") {
        if (selectedLog) {
          setSelectedLog(null);
          setSelectedIndex(-1);
        }
        return;
      }

      if (selectedLog) {
        // Navigation in detail view
        if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
          e.preventDefault();
          if (selectedIndex > 0) {
            const newIndex = selectedIndex - 1;
            setSelectedIndex(newIndex);
            setSelectedLog(logs[newIndex]);
          }
        } else if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
          e.preventDefault();
          if (selectedIndex < logs.length - 1) {
            const newIndex = selectedIndex + 1;
            setSelectedIndex(newIndex);
            setSelectedLog(logs[newIndex]);
          }
        }
      } else {
        // Navigation in list
        if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
          e.preventDefault();
          if (selectedIndex < logs.length - 1) {
            const newIndex = selectedIndex + 1;
            setSelectedIndex(newIndex);
          }
        } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
          e.preventDefault();
          if (selectedIndex > 0) {
            const newIndex = selectedIndex - 1;
            setSelectedIndex(newIndex);
          }
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < logs.length) {
            setSelectedLog(logs[selectedIndex]);
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedLog, selectedIndex, logs]);

  // Client-side filtering
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      if (statusFilter === "success" && (log.responseStatus < 200 || log.responseStatus >= 300 || log.error)) return false;
      if (statusFilter === "error" && (log.responseStatus >= 200 && log.responseStatus < 300 && !log.error)) return false;
      if (statusFilter === "pending" && log.status !== "pending") return false;
      if (statusFilter === "streaming" && log.status !== "streaming") return false;
      if (statusFilter === "completed" && log.status !== "completed") return false;
      if (methodFilter !== "all") {
        if (methodFilter === "other") {
          if (["POST", "GET", "PUT", "DELETE"].includes(log.method)) return false;
        } else if (log.method !== methodFilter) {
          return false;
        }
      }
      if (durationFilter === "slow" && log.durationMs < 3000) return false;
      return true;
    });
  }, [logs, statusFilter, methodFilter, durationFilter]);

  async function handleClear() {
    if (!confirm("确认清空所有日志？")) return;
    await fetch("/api/query?type=logs", { method: "DELETE" });
    setLogs([]);
    setTotal(0);
    setOffset(0);
  }

  function statusClass(status: number) {
    if (status === 0) return "status-err";
    if (status >= 200 && status < 300) return "status-ok";
    return "status-err";
  }

  function getStatusBadge(status?: string) {
    switch (status) {
      case "pending":
        return <span className="status-badge pending" title="请求已发送，等待响应">请求中</span>;
      case "streaming":
        return <span className="status-badge streaming" title="正在接收流式响应">流式中</span>;
      case "completed":
        return <span className="status-badge completed" title="请求已完成">完成</span>;
      case "error":
        return <span className="status-badge error" title="请求出错">错误</span>;
      default:
        return <span className="status-badge unknown" title="状态未知">-</span>;
    }
  }

  const rowHeightClass = density === "compact" ? "row-compact" : "row-comfortable";

  return (
    <div>
      {/* Toolbar */}
      <div className="log-toolbar">
        <select value={filterTarget} onChange={(e) => { setFilterTarget(e.target.value); setOffset(0); }}>
          <option value="">全部目标</option>
          {config.targets.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        {/* Status Filter */}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">全部状态</option>
          <option value="pending">请求中</option>
          <option value="streaming">流式接收</option>
          <option value="completed">已完成</option>
          <option value="success">成功 (2xx)</option>
          <option value="error">错误</option>
        </select>

        {/* Method Filter */}
        <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value as MethodFilter)}>
          <option value="all">全部方法</option>
          <option value="POST">POST</option>
          <option value="GET">GET</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
          <option value="other">其他</option>
        </select>

        {/* Duration Filter */}
        <select value={durationFilter} onChange={(e) => setDurationFilter(e.target.value as DurationFilter)}>
          <option value="all">全部耗时</option>
          <option value="slow">慢请求 (&gt;3s)</option>
        </select>

        {/* Density Toggle */}
        <div className="density-toggle">
          <button
            className={`density-btn ${density === "compact" ? "active" : ""}`}
            onClick={() => setDensity("compact")}
            title="紧凑"
          >
            ≡
          </button>
          <button
            className={`density-btn ${density === "comfortable" ? "active" : ""}`}
            onClick={() => setDensity("comfortable")}
            title="舒适"
          >
            ☰
          </button>
        </div>

        <button className="btn-ghost btn-sm" onClick={() => { setOffset(0); void fetchLogs(true); }} disabled={isRefreshing}>
          {isRefreshing ? "⟳" : "刷新"}
        </button>

        {/* Auto Refresh Toggle */}
        <label className="auto-refresh-label">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          <span>自动刷新</span>
          {autoRefresh && (
            <span className="refresh-indicator" title={`最后更新: ${lastRefresh.toLocaleTimeString()}`}>
              ●
            </span>
          )}
        </label>

        <span style={{ marginLeft: "auto", color: "#9ca3af", fontSize: 12 }}>
          共 {total} 条
          {filteredLogs.length !== logs.length && ` (筛选后 ${filteredLogs.length} 条)`}
        </span>

        {totalPages > 1 && (
          <div className="pagination-controls">
            <button
              className="btn-ghost btn-sm"
              disabled={currentPage === 1}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              上一页
            </button>
            <select
              className="page-select"
              value={currentPage}
              onChange={(e) => setOffset((Number(e.target.value) - 1) * limit)}
            >
              {Array.from({ length: totalPages }, (_, i) => (
                <option key={i + 1} value={i + 1}>第 {i + 1} 页</option>
              ))}
            </select>
            <button
              className="btn-ghost btn-sm"
              disabled={currentPage === totalPages}
              onClick={() => setOffset(offset + limit)}
            >
              下一页
            </button>
          </div>
        )}
        <button className="btn-danger btn-sm" onClick={handleClear}>清空</button>
      </div>

      {logs.length === 0 ? (
        <p className="empty">暂无日志</p>
      ) : filteredLogs.length === 0 ? (
        <p className="empty">没有符合筛选条件的日志</p>
      ) : (
        <>
          <div className="log-table-wrap">
            <table className={`log-table ${rowHeightClass}`}>
              <thead>
                <tr>
                  <th style={{ width: 100 }}>时间</th>
                  <th style={{ width: 80 }}>目标</th>
                  <th style={{ width: 60 }}>方法</th>
                  <th style={{ minWidth: 200 }}>最后消息 / 响应</th>
                  <th style={{ width: 70 }}>HTTP</th>
                  <th style={{ width: 60 }}>状态</th>
                  <th style={{ width: 100 }}>Token</th>
                  <th style={{ width: 80 }}>耗时</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log, index) => {
                  const requestLines = extractLastMessageLines(log.modifiedRequestBody);
                  const responseLines = log.assembledResponseBody 
                    ? extractResponseLines(log.assembledResponseBody)
                    : extractResponseLines(log.responseBody);
                  const hasContent = requestLines.length > 0 || responseLines.length > 0;
                  const isSelected = selectedIndex === index;
                  return (
                    <tr
                      key={log.id}
                      className={isSelected ? "selected" : ""}
                      onClick={() => {
                        setSelectedIndex(index);
                        setSelectedLog(log);
                      }}
                    >
                      <td className="time-cell" title={new Date(log.timestamp).toLocaleString()}>
                        {formatTime(log.timestamp)}
                      </td>
                      <td>{log.targetName}</td>
                      <td><span className="method-badge">{log.method}</span></td>
                      <td style={{ maxWidth: 500 }}>
                        {requestLines.length > 0 && (
                          <div className="log-preview-row">
                            <div className="log-preview-label">请求</div>
                            <div className="log-preview-content">
                              {requestLines.map((line, idx) => (
                                <div key={`req-${idx}`} className="log-preview-line" title={line}>
                                  {line}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {responseLines.length > 0 && (
                          <div className="log-preview-row" style={{ marginTop: requestLines.length > 0 ? 4 : 0 }}>
                            <div className="log-preview-label">响应</div>
                            <div className="log-preview-content">
                              {responseLines.map((line, idx) => (
                                <div key={`resp-${idx}`} className="log-preview-line" title={line}>
                                  {line}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {!hasContent && (
                          <span style={{ color: "#9ca3af", fontSize: 12 }}>-</span>
                        )}
                      </td>
                      <td className={statusClass(log.responseStatus)}>
                        {log.responseStatus || (log.error ? "ERR" : "-")}
                      </td>
                      <td>{getStatusBadge(log.status)}</td>
                      <td style={{ color: "#6b7280", whiteSpace: "nowrap", fontSize: 12 }}>
                        {log.tokenUsage ? (
                          <span
                            title={[
                              `输入: ${log.tokenUsage.inputTokens ?? "-"}`,
                              `输出: ${log.tokenUsage.outputTokens ?? "-"}`,
                              log.tokenUsage.totalTokens != null ? `总计: ${log.tokenUsage.totalTokens}` : null,
                              log.tokenUsage.cacheReadTokens != null ? `缓存读取: ${log.tokenUsage.cacheReadTokens}` : null,
                              log.tokenUsage.cacheCreationTokens != null ? `缓存创建: ${log.tokenUsage.cacheCreationTokens}` : null,
                            ].filter(Boolean).join("\n")}
                          >
                            {log.tokenUsage.inputTokens ?? "?"} / {log.tokenUsage.outputTokens ?? "?"}
                          </span>
                        ) : (
                          <span style={{ color: "#9ca3af" }}>-</span>
                        )}
                      </td>
                      <td style={{ color: "#6b7280", whiteSpace: "nowrap" }}>
                        {log.firstChunkMs ? (
                          <span title={`首包: ${log.firstChunkMs}ms, 总耗时: ${log.durationMs}ms`}>
                            {log.firstChunkMs}ms / {log.durationMs}ms
                          </span>
                        ) : (
                          `${log.durationMs}ms`
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ marginTop: 12, textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
              第 {currentPage} / {totalPages} 页，显示 {offset + 1}–{Math.min(offset + limit, total)} 条，共 {total} 条
            </div>
          )}
        </>
      )}

      {/* Side Panel */}
      <LogDetailPanel
        log={selectedLog}
        onClose={() => {
          setSelectedLog(null);
          setSelectedIndex(-1);
        }}
      />
    </div>
  );
}
