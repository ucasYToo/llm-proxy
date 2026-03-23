
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Config, LogEntry } from "@/lib/types";
import { formatTime, statusClass } from "@/lib/format";
import { extractLastMessageLines, extractResponseLines } from "@/lib/contentExtractor";
import LogDetailPanel from "../LogDetailPanel";
import styles from "./index.module.css";

type Density = "compact" | "comfortable";
type StatusFilter = "all" | "success" | "error" | "pending" | "streaming" | "completed";
type MethodFilter = "all" | "POST" | "GET" | "PUT" | "DELETE" | "other";
type DurationFilter = "all" | "slow";

interface Props {
  config: Config;
}

const LogsTab = ({ config }: Props) => {
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

  // 初始加载和自动刷新
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

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 在输入框/选择框中输入时忽略
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
        // 详情视图中的导航
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
        // 列表中的导航
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

  // 客户端筛选
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

  const handleClear = async () => {
    if (!confirm("确认清空所有日志？")) return;
    await fetch("/api/query?type=logs", { method: "DELETE" });
    setLogs([]);
    setTotal(0);
    setOffset(0);
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case "pending":
        return <span className={`${styles.statusBadge} ${styles.pending}`} title="请求已发送，等待响应">请求中</span>;
      case "streaming":
        return <span className={`${styles.statusBadge} ${styles.streaming}`} title="正在接收流式响应">流式中</span>;
      case "completed":
        return <span className={`${styles.statusBadge} ${styles.completed}`} title="请求已完成">完成</span>;
      case "error":
        return <span className={`${styles.statusBadge} ${styles.error}`} title="请求出错">错误</span>;
      default:
        return <span className={`${styles.statusBadge} ${styles.unknown}`} title="状态未知">-</span>;
    }
  };

  return (
    <div>
      {/* 工具栏 */}
      <div className={styles.logToolbar}>
        <select value={filterTarget} onChange={(e) => { setFilterTarget(e.target.value); setOffset(0); }}>
          <option value="">全部目标</option>
          {config.targets.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        {/* 状态筛选 */}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">全部状态</option>
          <option value="pending">请求中</option>
          <option value="streaming">流式接收</option>
          <option value="completed">已完成</option>
          <option value="success">成功 (2xx)</option>
          <option value="error">错误</option>
        </select>

        {/* 方法筛选 */}
        <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value as MethodFilter)}>
          <option value="all">全部方法</option>
          <option value="POST">POST</option>
          <option value="GET">GET</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
          <option value="other">其他</option>
        </select>

        {/* 耗时筛选 */}
        <select value={durationFilter} onChange={(e) => setDurationFilter(e.target.value as DurationFilter)}>
          <option value="all">全部耗时</option>
          <option value="slow">慢请求 (&gt;3s)</option>
        </select>

        {/* 密度切换 */}
        <div className={styles.densityToggle}>
          <button
            className={`${styles.densityBtn} ${density === "compact" ? styles.active : ""}`}
            onClick={() => setDensity("compact")}
            title="紧凑"
          >
            ≡
          </button>
          <button
            className={`${styles.densityBtn} ${density === "comfortable" ? styles.active : ""}`}
            onClick={() => setDensity("comfortable")}
            title="舒适"
          >
            ☰
          </button>
        </div>

        <button className="btnGhost btnSm" onClick={() => { setOffset(0); void fetchLogs(true); }} disabled={isRefreshing}>
          {isRefreshing ? "⟳" : "刷新"}
        </button>

        {/* 自动刷新开关 */}
        <label className={styles.autoRefreshLabel}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          <span>自动刷新</span>
          {autoRefresh && (
            <span className={styles.refreshIndicator} title={`最后更新: ${lastRefresh.toLocaleTimeString()}`}>
              ●
            </span>
          )}
        </label>

        <span style={{ marginLeft: "auto", color: "#9ca3af", fontSize: 12 }}>
          共 {total} 条
          {filteredLogs.length !== logs.length && ` (筛选后 ${filteredLogs.length} 条)`}
        </span>

        {totalPages > 1 && (
          <div className={styles.paginationControls}>
            <button
              className="btnGhost btnSm"
              disabled={currentPage === 1}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              上一页
            </button>
            <select
              className={styles.pageSelect}
              value={currentPage}
              onChange={(e) => setOffset((Number(e.target.value) - 1) * limit)}
            >
              {Array.from({ length: totalPages }, (_, i) => (
                <option key={i + 1} value={i + 1}>第 {i + 1} 页</option>
              ))}
            </select>
            <button
              className="btnGhost btnSm"
              disabled={currentPage === totalPages}
              onClick={() => setOffset(offset + limit)}
            >
              下一页
            </button>
          </div>
        )}
        <button className="btnDanger btnSm" onClick={handleClear}>清空</button>
      </div>

      {logs.length === 0 ? (
        <p className="empty">暂无日志</p>
      ) : filteredLogs.length === 0 ? (
        <p className="empty">没有符合筛选条件的日志</p>
      ) : (
        <>
          <div className={styles.logTableWrap}>
            <table className={`${styles.logTable} ${density === 'compact' ? styles.rowCompact : styles.rowComfortable}`}>
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
                      className={isSelected ? styles.selected : ""}
                      onClick={() => {
                        setSelectedIndex(index);
                        setSelectedLog(log);
                      }}
                    >
                      <td className={styles.timeCell} title={new Date(log.timestamp).toLocaleString()}>
                        {formatTime(log.timestamp)}
                      </td>
                      <td>{log.targetName}</td>
                      <td><span className={styles.methodBadge}>{log.method}</span></td>
                      <td style={{ maxWidth: 500 }}>
                        {requestLines.length > 0 && (
                          <div className={styles.logPreviewRow}>
                            <div className={styles.logPreviewLabel}>请求</div>
                            <div className={styles.logPreviewContent}>
                              {requestLines.map((line, idx) => (
                                <div key={`req-${idx}`} className={styles.logPreviewLine} title={line}>
                                  {line}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {responseLines.length > 0 && (
                          <div className={styles.logPreviewRow} style={{ marginTop: requestLines.length > 0 ? 4 : 0 }}>
                            <div className={styles.logPreviewLabel}>响应</div>
                            <div className={styles.logPreviewContent}>
                              {responseLines.map((line, idx) => (
                                <div key={`resp-${idx}`} className={styles.logPreviewLine} title={line}>
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

      {/* 侧边详情面板 */}
      <LogDetailPanel
        log={selectedLog}
        onClose={() => {
          setSelectedLog(null);
          setSelectedIndex(-1);
        }}
      />
    </div>
  );
};
export default LogsTab;
