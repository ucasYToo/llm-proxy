import { useCallback, useEffect, useMemo, useState } from "react";
import type { Config, LogEntry } from "../../lib/api";
import { clearLogs, queryLogs } from "../../lib/api";
import {
  extractLastMessageLines,
  extractResponseLines,
} from "../../lib/contentExtractor";
import { formatTime, formatTTFT, formatTPS } from "../../lib/format";
import { LogDetailPanel } from "../LogDetailPanel";
import styles from "./index.module.css";

type Density = "compact" | "comfortable";
type StatusFilter =
  | "all"
  | "success"
  | "error"
  | "pending"
  | "streaming"
  | "completed";
type MethodFilter = "all" | "POST" | "GET" | "PUT" | "DELETE" | "other";
type DurationFilter = "all" | "slow";
const basename = (p?: string | null) => p?.split("/").pop() ?? "";

interface AgentChip {
  id: string;
  label: string;
  type: "main" | "subagent";
  agentId?: string;
}

interface LogsTabProps {
  config: Config;
}

const LogsTab = ({ config }: LogsTabProps) => {
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
  const [selectedAgentChip, setSelectedAgentChip] = useState<string>("all");
  const [cwdFilter, setCwdFilter] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const limit = 20;

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  const fetchLogs = useCallback(
    async (showLoading = false) => {
      if (showLoading) setIsRefreshing(true);
      try {
        const data = await queryLogs({
          limit,
          offset,
          targetId: filterTarget || undefined,
          summary: false,
        });
        setLogs(data.entries);
        setTotal(data.total);
        setLastRefresh(new Date());
      } finally {
        if (showLoading) setIsRefreshing(false);
      }
    },
    [offset, filterTarget],
  );

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
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
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedLog, selectedIndex, logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (
        statusFilter === "success" &&
        (log.status !== "completed" || log.error)
      )
        return false;
      if (statusFilter === "error" && !log.error && log.status === "completed")
        return false;
      if (statusFilter === "pending" && log.status !== "pending") return false;
      if (statusFilter === "streaming" && log.status !== "streaming")
        return false;
      if (statusFilter === "completed" && log.status !== "completed")
        return false;
      if (methodFilter !== "all") {
        if (methodFilter === "other") {
          if (["POST", "GET", "PUT", "DELETE"].includes(log.method))
            return false;
        } else if (log.method !== methodFilter) {
          return false;
        }
      }
      if (durationFilter === "slow" && log.durationMs < 3000) return false;
      if (selectedAgentChip === "main" && log.agentId) return false;
      if (selectedAgentChip === "subagent" && !log.agentId) return false;
      if (selectedAgentChip !== "all" && selectedAgentChip !== "main" && selectedAgentChip !== "subagent") {
        if (log.agentId !== selectedAgentChip) return false;
      }
      if (cwdFilter && basename(log.cwd) !== cwdFilter) return false;
      return true;
    });
  }, [logs, statusFilter, methodFilter, durationFilter, selectedAgentChip, cwdFilter]);

  const agentChips = useMemo<AgentChip[]>(() => {
    const map = new Map<string, { agentType: string; count: number }>();
    for (const log of logs) {
      if (!log.agentId) continue;
      const existing = map.get(log.agentId);
      if (existing) {
        existing.count++;
      } else {
        map.set(log.agentId, { agentType: log.agentType ?? "Agent", count: 1 });
      }
    }
    return Array.from(map.entries()).map(([agentId, { agentType }]) => ({
      id: agentId,
      label: `${agentType}-${agentId.slice(-3)}`,
      type: "subagent" as const,
      agentId,
    }));
  }, [logs]);

  const availableCwds = useMemo(() => {
    const set = new Set<string>();
    for (const log of logs) {
      const name = basename(log.cwd);
      if (name) set.add(name);
    }
    return Array.from(set).sort();
  }, [logs]);

  const handleClear = async () => {
    if (!confirm("确认清空所有日志？")) return;
    await clearLogs();
    setLogs([]);
    setTotal(0);
    setOffset(0);
  };

  const getStatusBadge = (status?: string | null) => {
    switch (status) {
      case "pending":
        return (
          <span
            className={`${styles.statusBadge} ${styles.pending}`}
            title="请求已发送，等待响应"
          >
            请求中
          </span>
        );
      case "streaming":
        return (
          <span
            className={`${styles.statusBadge} ${styles.streaming}`}
            title="正在接收流式响应"
          >
            流式中
          </span>
        );
      case "completed":
        return (
          <span
            className={`${styles.statusBadge} ${styles.completed}`}
            title="请求已完成"
          >
            完成
          </span>
        );
      case "error":
        return (
          <span
            className={`${styles.statusBadge} ${styles.error}`}
            title="请求出错"
          >
            错误
          </span>
        );
      default:
        return (
          <span
            className={`${styles.statusBadge} ${styles.unknown}`}
            title="状态未知"
          >
            -
          </span>
        );
    }
  };

  return (
    <div>
      <div className={styles.logToolbar}>
        <select
          value={filterTarget}
          onChange={(e) => {
            setFilterTarget(e.target.value);
            setOffset(0);
            void fetchLogs();
          }}
        >
          <option value="">全部目标</option>
          {config.targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="all">全部状态</option>
          <option value="pending">请求中</option>
          <option value="streaming">流式接收</option>
          <option value="completed">已完成</option>
          <option value="success">成功 (2xx)</option>
          <option value="error">错误</option>
        </select>

        <select
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value as MethodFilter)}
        >
          <option value="all">全部方法</option>
          <option value="POST">POST</option>
          <option value="GET">GET</option>
          <option value="PUT">PUT</option>
          <option value="DELETE">DELETE</option>
          <option value="other">其他</option>
        </select>

        <select
          value={durationFilter}
          onChange={(e) => setDurationFilter(e.target.value as DurationFilter)}
        >
          <option value="all">全部耗时</option>
          <option value="slow">慢请求 (&gt;3s)</option>
        </select>

        {availableCwds.length > 1 && (
          <select
            value={cwdFilter}
            onChange={(e) => setCwdFilter(e.target.value)}
          >
            <option value="">全部项目</option>
            {availableCwds.map((cwd) => (
              <option key={cwd} value={cwd}>{cwd}</option>
            ))}
          </select>
        )}

        <div className={styles.densityToggle}>
          <button
            className={`${styles.densityBtn} ${density === "compact" ? styles.active : ""}`}
            onClick={() => setDensity("compact")}
            title="紧凑"
          >
            ≡{" "}
          </button>
          <button
            className={`${styles.densityBtn} ${density === "comfortable" ? styles.active : ""}`}
            onClick={() => setDensity("comfortable")}
            title="舒适"
          >
            ☰{" "}
          </button>
        </div>

        <button
          className="btnGhost btnSm"
          onClick={() => {
            setOffset(0);
            void fetchLogs(true);
          }}
          disabled={isRefreshing}
        >
          {isRefreshing ? "\u27f3" : "\u5237\u65b0"}
        </button>

        <label className={styles.autoRefreshLabel}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          <span>自动刷新</span>
          {autoRefresh && (
            <span
              className={styles.refreshIndicator}
              title={`最后更新: ${lastRefresh.toLocaleTimeString()}`}
            >
              ●
            </span>
          )}
        </label>

        <span style={{ marginLeft: "auto", color: "#9ca3af", fontSize: 12 }}>
          共 {total} 条
          {filteredLogs.length !== logs.length &&
            ` (筛选后 ${filteredLogs.length} 条)`}
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
                <option key={i + 1} value={i + 1}>
                  第 {i + 1} 页
                </option>
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
        <button className="btnDanger btnSm" onClick={handleClear}>
          清空
        </button>
      </div>

      <div className={styles.agentChipRow}>
        <button
          className={`${styles.agentChip}${selectedAgentChip === "all" ? ` ${styles.agentChipActive}` : ""}`}
          onClick={() => setSelectedAgentChip("all")}
        >
          全部
        </button>
        <button
          className={`${styles.agentChip}${selectedAgentChip === "main" ? ` ${styles.agentChipActive}` : ""}`}
          onClick={() => setSelectedAgentChip("main")}
        >
          主Agent
        </button>
        <button
          className={`${styles.agentChip}${selectedAgentChip === "subagent" ? ` ${styles.agentChipActive}` : ""}`}
          onClick={() => setSelectedAgentChip("subagent")}
        >
          子Agent
        </button>
        {agentChips.length > 0 && <span className={styles.agentChipDivider} />}
        {agentChips.map((chip) => (
          <button
            key={chip.id}
            className={`${styles.agentChip}${selectedAgentChip === chip.id ? ` ${styles.agentChipActive}` : ""}`}
            onClick={() => setSelectedAgentChip(selectedAgentChip === chip.id ? "all" : chip.id)}
            title={chip.agentId}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {logs.length === 0 ? (
        <p className="empty">暂无日志</p>
      ) : filteredLogs.length === 0 ? (
        <p className="empty">没有符合筛选条件的日志</p>
      ) : (
        <>
          <div className={styles.logTableWrap}>
            <table
              className={`${styles.logTable} ${density === "compact" ? styles.rowCompact : styles.rowComfortable}`}
            >
              <thead>
                <tr>
                  <th style={{ width: 100 }}>时间</th>
                  <th style={{ width: 80 }}>目标</th>
                  <th style={{ width: 90 }}>项目</th>
                  <th style={{ width: 60 }}>Agent</th>
                  <th style={{ width: 60 }}>方法</th>
                  <th style={{ minWidth: 200 }}>最后消息 / 响应</th>
                  <th style={{ width: 70 }}>HTTP</th>
                  <th style={{ width: 60 }}>状态</th>
                  <th style={{ width: 100 }}>Token</th>
                  <th style={{ width: 80 }}>耗时</th>
                  <th style={{ width: 70 }}>首包</th>
                  <th style={{ width: 80 }}>TPS</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log, index) => {
                  const requestLines = extractLastMessageLines(
                    log.modifiedRequestBody,
                  );
                  const responseLines = log.assembledResponseBody
                    ? extractResponseLines(log.assembledResponseBody)
                    : extractResponseLines(log.responseBody);
                  const hasContent =
                    requestLines.length > 0 || responseLines.length > 0;
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
                      <td
                        className={styles.timeCell}
                        title={new Date(log.timestamp).toLocaleString()}
                      >
                        {formatTime(log.timestamp)}
                      </td>
                      <td>{log.targetName}</td>
                      <td title={log.cwd ?? ""} style={{ fontSize: 11, color: "#6b7280" }}>
                        {basename(log.cwd) || "-"}
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {log.agentId ? (
                          <span className={styles.statusBadge} style={{ background: "rgba(99,102,241,0.12)", color: "#6366f1" }}
                            title={log.agentId}>{log.agentType ?? "子"}</span>
                        ) : (
                          <span style={{ color: "#9ca3af" }}>主</span>
                        )}
                      </td>
                      <td>
                        <span className={styles.methodBadge}>{log.method}</span>
                      </td>
                      <td style={{ maxWidth: 500 }}>
                        {requestLines.length > 0 && (
                          <div className={styles.logPreviewRow}>
                            <div className={styles.logPreviewLabel}>请求</div>
                            <div className={styles.logPreviewContent}>
                              {requestLines.map((line, idx) => (
                                <div
                                  key={`req-${idx}`}
                                  className={styles.logPreviewLine}
                                  title={line}
                                >
                                  {line}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {responseLines.length > 0 && (
                          <div
                            className={styles.logPreviewRow}
                            style={{
                              marginTop: requestLines.length > 0 ? 4 : 0,
                            }}
                          >
                            <div className={styles.logPreviewLabel}>响应</div>
                            <div className={styles.logPreviewContent}>
                              {responseLines.map((line, idx) => (
                                <div
                                  key={`resp-${idx}`}
                                  className={styles.logPreviewLine}
                                  title={line}
                                >
                                  {line}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {!hasContent && (
                          <span style={{ color: "#9ca3af", fontSize: 12 }}>
                            -
                          </span>
                        )}
                      </td>
                      <td>{log.responseStatus || "-"}</td>
                      <td>{getStatusBadge(log.status)}</td>
                      <td
                        style={{
                          color: "#6b7280",
                          whiteSpace: "nowrap",
                          fontSize: 12,
                        }}
                      >
                        {log.tokenUsage ? (
                          <span
                            title={[
                              `输入: ${log.tokenUsage.inputTokens ?? "-"}`,
                              `输出: ${log.tokenUsage.outputTokens ?? "-"}`,
                              log.tokenUsage.totalTokens != null
                                ? `总计: ${log.tokenUsage.totalTokens}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join("\n")}
                          >
                            {log.tokenUsage.inputTokens ?? "?"} /{" "}
                            {log.tokenUsage.outputTokens ?? "?"}
                          </span>
                        ) : (
                          <span style={{ color: "#9ca3af" }}>-</span>
                        )}
                      </td>
                      <td style={{ color: "#6b7280", whiteSpace: "nowrap" }}>
                        {log.durationMs}ms
                      </td>
                      <td
                        style={{
                          color: "#6b7280",
                          whiteSpace: "nowrap",
                          fontSize: 12,
                        }}
                      >
                        {formatTTFT(log.firstChunkMs)}
                      </td>
                      <td
                        style={{
                          color: "#6b7280",
                          whiteSpace: "nowrap",
                          fontSize: 12,
                        }}
                      >
                        {formatTPS(
                          log.tokenUsage?.outputTokens,
                          log.durationMs,
                          log.firstChunkMs,
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div
              style={{
                marginTop: 12,
                textAlign: "center",
                color: "#9ca3af",
                fontSize: 12,
              }}
            >
              第 {currentPage} / {totalPages} 页，显示 {offset + 1}–
              {Math.min(offset + limit, total)} 条，共 {total} 条
            </div>
          )}
        </>
      )}

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
