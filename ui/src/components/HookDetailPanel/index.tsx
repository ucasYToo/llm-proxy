import { useCallback, useEffect, useRef, useState } from "react";
import type { HookEntry } from "../../lib/api";
import { JsonViewer } from "../JsonViewer";
import styles from "./index.module.css";

interface HookDetailPanelProps {
  entry: HookEntry | null;
  onClose: () => void;
}

const shortSession = (sid: string | null): string => {
  if (!sid) return "—";
  return sid.length > 16 ? `${sid.slice(0, 6)}…${sid.slice(-6)}` : sid;
};

const cwdFromEntry = (e: HookEntry): string | null => {
  if (e.cwd) return e.cwd;
  const payload = e.payload as Record<string, unknown> | null;
  const fromPayload = payload?.cwd ?? payload?.workingDirectory;
  return typeof fromPayload === "string" ? fromPayload : null;
};

export function HookDetailPanel({ entry, onClose }: HookDetailPanelProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(600);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => {
    setIsVisible(!!entry);
  }, [entry]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartX.current = e.clientX;
      dragStartWidth.current = panelWidth;
      setIsDragging(true);
    },
    [panelWidth],
  );

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

  useEffect(() => {
    if (!entry) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement
        ) {
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry, onClose]);

  if (!entry) return null;

  const panelStyle = isFullscreen
    ? {}
    : { width: Math.min(panelWidth, window.innerWidth) };

  const panelClass = [
    styles.panel,
    isVisible ? styles.visible : "",
    isFullscreen ? styles.fullscreen : "",
  ]
    .filter(Boolean)
    .join(" ");

  const cwd = cwdFromEntry(entry);

  return (
    <>
      {!isFullscreen && (
        <div
          className={`${styles.backdrop}${isVisible ? ` ${styles.visible}` : ""}`}
          onClick={onClose}
        />
      )}

      <div className={panelClass} style={panelStyle}>
        {!isFullscreen && (
          <div
            className={`${styles.dragHandle}${isDragging ? ` ${styles.dragging}` : ""}`}
            onMouseDown={handleDragStart}
          />
        )}

        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <span className={styles.eventBadge}>hook</span>
            <span className={styles.eventName}>{entry.eventName}</span>
            {entry.toolName && (
              <span className={styles.toolName}>{entry.toolName}</span>
            )}
          </div>
          <button
            className="btnGhost btnSm"
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? "退出全屏" : "全屏"}
          >
            {isFullscreen ? "⊡" : "⛶"}
          </button>
          <button className="btnGhost btnSm" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className={styles.meta}>
          <span>
            <strong>session：</strong>
            <span className={styles.mono}>{shortSession(entry.sessionId)}</span>
          </span>
          <span>
            <strong>时间：</strong>
            {new Date(entry.createdAt).toLocaleString()}
          </span>
          {cwd && (
            <span className={styles.metaCwd} title={cwd}>
              <strong>cwd：</strong>
              <span className={styles.mono}>{cwd}</span>
            </span>
          )}
        </div>

        <div className={styles.body}>
          <p className={styles.sectionTitle}>Payload</p>
          {entry.payload !== null && entry.payload !== undefined ? (
            typeof entry.payload === "object" ? (
              <JsonViewer data={entry.payload} />
            ) : (
              <pre className={styles.pre}>{String(entry.payload)}</pre>
            )
          ) : (
            <p className="empty" style={{ padding: 16 }}>
              无数据
            </p>
          )}
        </div>

        <div className={styles.keyboardHint}>
          <span>ESC 关闭</span>
        </div>
      </div>
    </>
  );
}
