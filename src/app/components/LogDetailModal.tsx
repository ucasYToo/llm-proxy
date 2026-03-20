"use client";
import { useState } from "react";
import { JsonView, defaultStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import type { LogEntry } from "@/lib/types";
import { jsonDiff, type DiffEntry } from "@/lib/jsonDiff";

type ViewMode = "detail" | "response" | "diff";

interface Props {
  log: LogEntry;
  onClose: () => void;
}

export default function LogDetailModal({ log, onClose }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("detail");

  function statusClass(status: number) {
    if (status === 0) return "status-err";
    if (status >= 200 && status < 300) return "status-ok";
    return "status-err";
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="log-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="log-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
            <span className="method-badge" style={{ fontSize: 13, padding: "2px 8px" }}>
              {log.method}
            </span>
            <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600 }}>
              {log.path}
            </span>
            <span className={statusClass(log.responseStatus)} style={{ fontSize: 13 }}>
              {log.responseStatus || (log.error ? "ERR" : "-")}
            </span>
            <span style={{ color: "#6b7280", fontSize: 12 }}>{log.durationMs}ms</span>
          </div>
          <button className="btn-ghost btn-sm" onClick={onClose} style={{ flexShrink: 0 }}>
            ✕
          </button>
        </div>

        {/* Meta info */}
        <div className="log-meta">
          <span><strong>目标：</strong>{log.targetName}</span>
          <span><strong>时间：</strong>{new Date(log.timestamp).toLocaleString()}</span>
        </div>

        {/* Error banner */}
        {log.error && (
          <div className="log-error-banner">
            <strong>错误：</strong>{log.error}
          </div>
        )}

        {/* View mode tabs */}
        <div className="log-modal-tabs">
          <button
            className={`log-modal-tab${viewMode === "detail" ? " active" : ""}`}
            onClick={() => setViewMode("detail")}
          >
            请求详情
          </button>
          <button
            className={`log-modal-tab${viewMode === "response" ? " active" : ""}`}
            onClick={() => setViewMode("response")}
          >
            响应体
          </button>
          <button
            className={`log-modal-tab${viewMode === "diff" ? " active" : ""}`}
            onClick={() => setViewMode("diff")}
          >
            Diff 对比
          </button>
        </div>

        {/* Content */}
        <div className="log-modal-body">
          {viewMode === "detail" && <DetailView log={log} />}
          {viewMode === "response" && <ResponseView log={log} />}
          {viewMode === "diff" && <DiffView log={log} />}
        </div>
      </div>
    </div>
  );
}

/* ── Detail View: shows modified headers/body (no response here) ── */
function DetailView({ log }: { log: LogEntry }) {
  return (
    <div className="detail-sections">
      <Section title="请求 Headers（修改后）" data={log.modifiedRequestHeaders} />
      <Section title="请求 Body（修改后）" data={log.modifiedRequestBody} />
    </div>
  );
}

/* ── Response View: assembled data first, then raw stream events ── */
function ResponseView({ log }: { log: LogEntry }) {
  const hasAssembled = log.assembledResponseBody !== null && log.assembledResponseBody !== undefined;
  const isStreamArray = Array.isArray(log.responseBody);

  return (
    <div className="detail-sections">
      {/* Assembled response (priority display) */}
      {hasAssembled && (
        <div className="detail-section">
          <div className="response-section-header">
            <p className="log-section-title">组装后响应</p>
            <span className="diff-badge" style={{ background: "#dbeafe", color: "#1e40af" }}>
              已合并
            </span>
          </div>
          <div className="json-viewer-wrap">
            <JsonView
              data={log.assembledResponseBody as object}
              shouldExpandNode={(level) => level < 5}
              style={defaultStyles}
            />
          </div>
        </div>
      )}

      {/* Raw response body */}
      <div className="detail-section">
        <div className="response-section-header">
          <p className="log-section-title">
            {hasAssembled ? "原始流式数据" : "响应 Body"}
          </p>
          {isStreamArray && (
            <span className="diff-badge" style={{ background: "#f3e8ff", color: "#6b21a8" }}>
              {(log.responseBody as unknown[]).length} 个事件
            </span>
          )}
        </div>
        {log.responseBody !== null && log.responseBody !== undefined ? (
          typeof log.responseBody === "object" ? (
            <div className="json-viewer-wrap">
              <JsonView
                data={log.responseBody as object}
                shouldExpandNode={(level) => level < 3}
                style={defaultStyles}
              />
            </div>
          ) : (
            <pre className="log-pre">{String(log.responseBody)}</pre>
          )
        ) : (
          <p className="empty" style={{ padding: 16 }}>无数据</p>
        )}
      </div>
    </div>
  );
}

function Section({ title, data }: { title: string; data: unknown }) {
  if (data === null || data === undefined) return null;

  const isJsonObject = typeof data === "object";

  return (
    <div className="detail-section">
      <p className="log-section-title">{title}</p>
      {isJsonObject ? (
        <div className="json-viewer-wrap">
          <JsonView
            data={data as object}
            shouldExpandNode={(level) => level < 2}
            style={defaultStyles}
          />
        </div>
      ) : (
        <pre className="log-pre">{String(data)}</pre>
      )}
    </div>
  );
}

/* ── Diff View: side-by-side original vs modified ── */
function DiffView({ log }: { log: LogEntry }) {
  // Use precomputed diff if original data was not captured
  const hasOriginal = log.originalRequestBody !== null || Object.keys(log.originalRequestHeaders ?? {}).length > 0;
  const headerDiffs = log.precomputedDiff
    ? log.precomputedDiff.headers
    : jsonDiff(log.originalRequestHeaders, log.modifiedRequestHeaders);
  const bodyDiffs = log.precomputedDiff
    ? log.precomputedDiff.body
    : jsonDiff(log.originalRequestBody, log.modifiedRequestBody);

  return (
    <div className="diff-sections">
      {!hasOriginal && log.precomputedDiff && (
        <div style={{ padding: "8px 16px", background: "#fffbeb", borderBottom: "1px solid #fde68a", fontSize: 12, color: "#92400e" }}>
          原始请求数据未采集，仅展示差异摘要（可在配置页开启"采集原始请求 Body"以查看完整对比）
        </div>
      )}
      <DiffSection
        title="Headers"
        original={hasOriginal ? log.originalRequestHeaders : null}
        modified={log.modifiedRequestHeaders}
        diffs={headerDiffs}
      />
      <DiffSection
        title="Body"
        original={hasOriginal ? log.originalRequestBody : null}
        modified={log.modifiedRequestBody}
        diffs={bodyDiffs}
      />
    </div>
  );
}

function DiffSection({
  title,
  original,
  modified,
  diffs,
}: {
  title: string;
  original: unknown;
  modified: unknown;
  diffs: DiffEntry[];
}) {
  if (original === null && modified === null) return null;
  if (original === undefined && modified === undefined) return null;

  const hasDiff = diffs.length > 0;

  return (
    <div className="diff-section">
      <div className="diff-section-header">
        <p className="log-section-title">{title}</p>
        {hasDiff ? (
          <span className="diff-badge diff-badge-changed">{diffs.length} 处差异</span>
        ) : (
          <span className="diff-badge diff-badge-same">无差异</span>
        )}
      </div>

      {hasDiff && (
        <div className="diff-entries">
          {diffs.map((d, i) => (
            <div key={i} className={`diff-entry diff-entry-${d.type}`}>
              <span className="diff-path">{d.path}</span>
              {d.type === "added" && (
                <span className="diff-value diff-added">
                  + {formatValue(d.newValue)}
                </span>
              )}
              {d.type === "removed" && (
                <span className="diff-value diff-removed">
                  - {formatValue(d.oldValue)}
                </span>
              )}
              {d.type === "changed" && (
                <>
                  <span className="diff-value diff-removed">
                    - {formatValue(d.oldValue)}
                  </span>
                  <span className="diff-value diff-added">
                    + {formatValue(d.newValue)}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="diff-container">
        <div className="diff-pane">
          <p className="diff-pane-title">原始请求</p>
          {original !== null && original !== undefined ? (
            typeof original === "object" ? (
              <div className="json-viewer-wrap">
                <JsonView
                  data={original as object}
                  shouldExpandNode={(level) => level < 3}
                  style={defaultStyles}
                />
              </div>
            ) : (
              <pre className="log-pre">{String(original)}</pre>
            )
          ) : (
            <p className="empty" style={{ padding: 16 }}>无数据</p>
          )}
        </div>
        <div className="diff-pane">
          <p className="diff-pane-title">修改后请求</p>
          {modified !== null && modified !== undefined ? (
            typeof modified === "object" ? (
              <div className="json-viewer-wrap">
                <JsonView
                  data={modified as object}
                  shouldExpandNode={(level) => level < 3}
                  style={defaultStyles}
                />
              </div>
            ) : (
              <pre className="log-pre">{String(modified)}</pre>
            )
          ) : (
            <p className="empty" style={{ padding: 16 }}>无数据</p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatValue(val: unknown): string {
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
