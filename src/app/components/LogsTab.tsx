"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import type { Config, LogEntry } from "@/lib/types";

interface Props {
  config: Config;
}

export default function LogsTab({ config }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filterTarget, setFilterTarget] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const limit = 50;

  const fetchLogs = useCallback(async () => {
    const params = new URLSearchParams({
      type: "logs",
      limit: String(limit),
      offset: String(offset),
    });
    if (filterTarget) params.set("targetId", filterTarget);
    const res = await fetch(`/api/query?${params}`);
    const data = (await res.json()) as { entries: LogEntry[]; total: number };
    setLogs(data.entries);
    setTotal(data.total);
  }, [offset, filterTarget]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

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

  return (
    <div>
      <div className="log-toolbar">
        <select value={filterTarget} onChange={(e) => { setFilterTarget(e.target.value); setOffset(0); }}>
          <option value="">全部目标</option>
          {config.targets.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button className="btn-ghost btn-sm" onClick={() => { setOffset(0); void fetchLogs(); }}>
          刷新
        </button>
        <span style={{ marginLeft: "auto", color: "#9ca3af", fontSize: 12 }}>共 {total} 条</span>
        <button className="btn-danger btn-sm" onClick={handleClear}>清空</button>
      </div>

      {logs.length === 0 ? (
        <p className="empty">暂无日志</p>
      ) : (
        <>
          <div className="log-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>目标</th>
                  <th>方法</th>
                  <th>路径</th>
                  <th>状态</th>
                  <th>耗时</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <Fragment key={log.id}>
                    <tr
                      style={{ cursor: "pointer" }}
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    >
                      <td style={{ whiteSpace: "nowrap", fontSize: 12, color: "#6b7280" }}>
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td>{log.targetName}</td>
                      <td><span className="method-badge">{log.method}</span></td>
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{log.path}</td>
                      <td className={statusClass(log.responseStatus)}>
                        {log.responseStatus || (log.error ? "ERR" : "-")}
                      </td>
                      <td style={{ color: "#6b7280" }}>{log.durationMs}ms</td>
                    </tr>
                    {expandedId === log.id && (
                      <tr>
                        <td colSpan={6} style={{ padding: 0 }}>
                          <LogDetail log={log} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex" style={{ justifyContent: "center", gap: 8, marginTop: 16 }}>
            <button
              className="btn-ghost btn-sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              上一页
            </button>
            <span style={{ color: "#6b7280", fontSize: 12, alignSelf: "center" }}>
              {offset + 1}–{Math.min(offset + limit, total)}
            </span>
            <button
              className="btn-ghost btn-sm"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LogDetail({ log }: { log: LogEntry }) {
  return (
    <div className="log-detail">
      {log.error && (
        <div style={{ marginBottom: 10 }}>
          <p className="log-section-title">错误</p>
          <pre style={{ color: "#ef4444" }}>{log.error}</pre>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <p className="log-section-title">原始请求 Headers</p>
          <pre>{JSON.stringify(log.originalRequestHeaders, null, 2)}</pre>
        </div>
        <div>
          <p className="log-section-title">修改后请求 Headers</p>
          <pre>{JSON.stringify(log.modifiedRequestHeaders, null, 2)}</pre>
        </div>
        <div>
          <p className="log-section-title">原始请求 Body</p>
          <pre>{JSON.stringify(log.originalRequestBody, null, 2)}</pre>
        </div>
        <div>
          <p className="log-section-title">修改后请求 Body</p>
          <pre>{JSON.stringify(log.modifiedRequestBody, null, 2)}</pre>
        </div>
        <div>
          <p className="log-section-title">响应状态</p>
          <pre>{log.responseStatus}</pre>
        </div>
        <div>
          <p className="log-section-title">响应 Body</p>
          <pre>
            {typeof log.responseBody === "string"
              ? log.responseBody
              : JSON.stringify(log.responseBody, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
