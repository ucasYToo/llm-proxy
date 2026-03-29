import { useCallback, useEffect, useRef, useState } from "react";
import type { LogEntry, DiffEntry } from "../../lib/api";
import { statusClass, formatValue } from "../../lib/format";
import { JsonViewer } from "../JsonViewer";
import styles from "./index.module.css";

type ViewMode = "detail" | "response" | "diff";

interface LogDetailPanelProps {
  log: LogEntry | null;
  onClose: () => void;
}

export function LogDetailPanel({
  log: logOrNull,
  onClose,
}: LogDetailPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("detail");
  const [isVisible, setIsVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(600);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const log = logOrNull;

  useEffect(() => {
    if (log) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [log]);

  useEffect(() => {
    if (log) {
      setViewMode("detail");
    }
  }, [log?.id]);

  /* ── 拖拽调整宽度 ── */
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    setIsDragging(true);
  }, [panelWidth]);

  useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (e: MouseEvent) => {
      const delta = dragStartX.current - e.clientX;
      const newWidth = Math.min(
        Math.max(dragStartWidth.current + delta, 400),
        Math.round(window.innerWidth * 0.9),
      );
      setPanelWidth(newWidth);
    };
    const onMouseUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging]);

  if (!log) return null;

  const panelStyle = isFullscreen
    ? {}
    : { width: Math.min(panelWidth, window.innerWidth) };

  const panelClass = [
    styles.logPanel,
    isVisible ? styles.visible : "",
    isFullscreen ? styles.fullscreen : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {/* 遮罩层（全屏时不显示） */}
      {!isFullscreen && (
        <div
          className={`${styles.panelBackdrop} ${isVisible ? styles.visible : ""}`}
          onClick={onClose}
        />
      )}

      {/* 面板 */}
      <div className={panelClass} style={panelStyle}>
        {/* 拖拽 handle（全屏时隐藏） */}
        {!isFullscreen && (
          <div
            className={`${styles.dragHandle}${isDragging ? ` ${styles.dragging}` : ""}`}
            onMouseDown={handleDragStart}
          />
        )}

        {/* 头部 */}
        <div className={styles.logPanelHeader}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flex: 1,
              minWidth: 0,
            }}
          >
            <span
              className="methodBadge"
              style={{ fontSize: 13, padding: "2px 8px", flexShrink: 0 }}
            >
              {log.method}
            </span>
            <span
              style={{
                fontFamily: "monospace",
                fontSize: 13,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {log.path}
            </span>
            <span className={statusClass(log.responseStatus)} style={{ fontSize: 13, flexShrink: 0 }}>
              {log.responseStatus || (log.error ? "ERR" : "-")}
            </span>
            <span style={{ color: "#6b7280", fontSize: 12, flexShrink: 0 }}>
              {log.durationMs}ms
            </span>
          </div>
          <button
            className="btnGhost btnSm"
            onClick={() => setIsFullscreen((v) => !v)}
            style={{ flexShrink: 0 }}
            title={isFullscreen ? "退出全屏" : "全屏"}
          >
            {isFullscreen ? "⊡" : "⛶"}
          </button>
          <button
            className="btnGhost btnSm"
            onClick={onClose}
            style={{ flexShrink: 0 }}
          >
            ✕
          </button>
        </div>

        {/* 元信息 */}
        <div className={styles.logMeta}>
          <span>
            <strong>目标：</strong>
            {log.targetName}
          </span>
          <span>
            <strong>时间：</strong>
            {new Date(log.timestamp).toLocaleString()}
          </span>
          {log.tokenUsage && (
            <span>
              <strong>Token：</strong>
              {log.tokenUsage.inputTokens ?? "?"} 输入 / {log.tokenUsage.outputTokens ?? "?"} 输出
              {log.tokenUsage.totalTokens != null && ` (共 ${log.tokenUsage.totalTokens})`}
              {log.tokenUsage.cacheReadTokens != null && ` | 缓存读取 ${log.tokenUsage.cacheReadTokens}`}
              {log.tokenUsage.cacheCreationTokens != null && ` | 缓存创建 ${log.tokenUsage.cacheCreationTokens}`}
            </span>
          )}
        </div>

        {/* 错误提示 */}
        {log.error && (
          <div className={styles.logErrorBanner}>
            <strong>错误：</strong>
            {log.error}
          </div>
        )}

        {/* 视图模式标签页 */}
        <div className={styles.logPanelTabs}>
          <button
            className={`${styles.logPanelTab}${viewMode === "detail" ? ` ${styles.active}` : ""}`}
            onClick={() => setViewMode("detail")}
          >
            请求详情
          </button>
          <button
            className={`${styles.logPanelTab}${viewMode === "response" ? ` ${styles.active}` : ""}`}
            onClick={() => setViewMode("response")}
          >
            响应体
          </button>
          <button
            className={`${styles.logPanelTab}${viewMode === "diff" ? ` ${styles.active}` : ""}`}
            onClick={() => setViewMode("diff")}
          >
            Diff 对比
          </button>
        </div>

        {/* 内容区 */}
        <div className={styles.logPanelBody}>
          {viewMode === "detail" && <DetailView log={log} />}
          {viewMode === "response" && <ResponseView log={log} />}
          {viewMode === "diff" && <DiffView log={log} />}
        </div>

        {/* 键盘提示 */}
        <div className={styles.panelKeyboardHint}>
          <span>↑/↓ 或 J/K 切换日志</span>
          <span>ESC 关闭</span>
        </div>
      </div>
    </>
  );
}

/* ── 详情视图：展示修改后的 headers/body ── */
const DetailView = ({ log }: { log: LogEntry }) => {
  return (
    <div className={styles.detailSections}>
      <Section title="请求 Headers（修改后）" data={log.modifiedRequestHeaders} />
      <Section title="请求 Body（修改后）" data={log.modifiedRequestBody} />
    </div>
  );
};

/* ── 响应视图：优先展示组装后数据，其次原始流式事件 ── */
const ResponseView = ({ log }: { log: LogEntry }) => {
  const hasAssembled = log.assembledResponseBody !== null && log.assembledResponseBody !== undefined;
  const isStreamArray = Array.isArray(log.responseBody);

  return (
    <div className={styles.detailSections}>
      {/* 组装后响应（优先展示） */}
      {hasAssembled && (
        <div className={styles.detailSection}>
          <div className={styles.responseSectionHeader}>
            <p className={styles.logSectionTitle}>组装后响应</p>
            <span className={styles.diffBadge} style={{ background: "#dbeafe", color: "#1e40af" }}>
              已合并
            </span>
          </div>
          <JsonViewer data={log.assembledResponseBody} />
        </div>
      )}

      {/* 原始响应体 */}
      <div className={styles.detailSection}>
        <div className={styles.responseSectionHeader}>
          <p className={styles.logSectionTitle}>
            {hasAssembled ? "原始流式数据" : "响应 Body"}
          </p>
          {isStreamArray && (
            <span className={styles.diffBadge} style={{ background: "#f3e8ff", color: "#6b21a8" }}>
              {(log.responseBody as unknown[]).length} 个事件
            </span>
          )}
        </div>
        {log.responseBody !== null && log.responseBody !== undefined ? (
          typeof log.responseBody === "object" ? (
            <JsonViewer data={log.responseBody} />
          ) : (
            <pre className={styles.logPre}>{String(log.responseBody)}</pre>
          )
        ) : (
          <p className="empty" style={{ padding: 16 }}>无数据</p>
        )}
      </div>
    </div>
  );
};

const Section = ({ title, data }: { title: string; data: unknown }) => {
  if (data === null || data === undefined) return null;

  return (
    <div className={styles.detailSection}>
      <p className={styles.logSectionTitle}>{title}</p>
      {typeof data === "object" ? (
        <JsonViewer data={data} />
      ) : (
        <pre className={styles.logPre}>{String(data)}</pre>
      )}
    </div>
  );
};

/* ── Diff 视图：原始请求与修改后请求的并排对比 ── */
const DiffView = ({ log }: { log: LogEntry }) => {
  const hasOriginal =
    log.originalRequestBody !== null ||
    Object.keys(log.originalRequestHeaders ?? {}).length > 0;

  const headerDiffs = log.precomputedDiff
    ? log.precomputedDiff.headers
    : simpleDiff(log.originalRequestHeaders, log.modifiedRequestHeaders);
  const bodyDiffs = log.precomputedDiff
    ? log.precomputedDiff.body
    : simpleDiff(log.originalRequestBody, log.modifiedRequestBody);

  return (
    <div className={styles.diffSections}>
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
};

/** 简单 diff：仅统计 key 级别的差异，用于没有 precomputedDiff 时的降级展示 */
const simpleDiff = (original: unknown, modified: unknown): DiffEntry[] => {
  if (typeof original !== "object" || typeof modified !== "object") return [];
  if (original === null || modified === null) return [];
  const orig = original as Record<string, unknown>;
  const mod = modified as Record<string, unknown>;
  const diffs: DiffEntry[] = [];
  const allKeys = new Set([...Object.keys(orig), ...Object.keys(mod)]);
  for (const key of allKeys) {
    if (!(key in orig)) {
      diffs.push({ path: key, type: "added", newValue: mod[key] });
    } else if (!(key in mod)) {
      diffs.push({ path: key, type: "removed", oldValue: orig[key] });
    } else if (JSON.stringify(orig[key]) !== JSON.stringify(mod[key])) {
      diffs.push({ path: key, type: "changed", oldValue: orig[key], newValue: mod[key] });
    }
  }
  return diffs;
};

const DiffSection = ({
  title,
  original,
  modified,
  diffs,
}: {
  title: string;
  original: unknown;
  modified: unknown;
  diffs: DiffEntry[];
}) => {
  if (original === null && modified === null) return null;
  if (original === undefined && modified === undefined) return null;

  const hasDiff = diffs.length > 0;

  return (
    <div className={styles.diffSection}>
      <div className={styles.diffSectionHeader}>
        <p className={styles.logSectionTitle}>{title}</p>
        {hasDiff ? (
          <span className={`${styles.diffBadge} ${styles.diffBadgeChanged}`}>{diffs.length} 处差异</span>
        ) : (
          <span className={`${styles.diffBadge} ${styles.diffBadgeSame}`}>无差异</span>
        )}
      </div>

      {hasDiff && (
        <div className={styles.diffEntries}>
          {diffs.map((d, i) => (
            <div key={i} className={styles.diffEntry}>
              <span className={styles.diffPath}>{d.path}</span>
              {d.type === "added" && (
                <span className={`${styles.diffValue} ${styles.diffAdded}`}>
                  + {formatValue(d.newValue)}
                </span>
              )}
              {d.type === "removed" && (
                <span className={`${styles.diffValue} ${styles.diffRemoved}`}>
                  - {formatValue(d.oldValue)}
                </span>
              )}
              {d.type === "changed" && (
                <>
                  <span className={`${styles.diffValue} ${styles.diffRemoved}`}>
                    - {formatValue(d.oldValue)}
                  </span>
                  <span className={`${styles.diffValue} ${styles.diffAdded}`}>
                    + {formatValue(d.newValue)}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className={styles.diffContainer}>
        <div className={styles.diffPane}>
          <p className={styles.diffPaneTitle}>原始请求</p>
          {original !== null && original !== undefined ? (
            typeof original === "object" ? (
              <JsonViewer data={original} />
            ) : (
              <pre className={styles.logPre}>{String(original)}</pre>
            )
          ) : (
            <p className="empty" style={{ padding: 16 }}>无数据</p>
          )}
        </div>
        <div className={styles.diffPane}>
          <p className={styles.diffPaneTitle}>修改后请求</p>
          {modified !== null && modified !== undefined ? (
            typeof modified === "object" ? (
              <JsonViewer data={modified} />
            ) : (
              <pre className={styles.logPre}>{String(modified)}</pre>
            )
          ) : (
            <p className="empty" style={{ padding: 16 }}>无数据</p>
          )}
        </div>
      </div>
    </div>
  );
};
