"use client";
import { useState } from "react";
import type { Config, Target, LogCollection } from "@/lib/types";
import TargetForm from "../TargetForm";
import styles from "./index.module.css";

interface Props {
  config: Config;
  onRefresh: () => void;
}

const ConfigTab = ({ config, onRefresh }: Props) => {
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Target | undefined>();

  const logCollection: LogCollection = config.logCollection ?? { captureOriginalBody: false, captureRawStreamEvents: false };

  const handleLogCollectionChange = async (key: keyof LogCollection, value: boolean) => {
    const updated = { ...logCollection, [key]: value };
    await fetch("/api/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "updateLogCollection", logCollection: updated }),
    });
    onRefresh();
  };

  const handleSetActive = async (targetId: string) => {
    await fetch("/api/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "setActive", targetId }),
    });
    onRefresh();
  };

  const handleSave = async (target: Omit<Target, "id"> & { id?: string }) => {
    const action = target.id ? "updateTarget" : "addTarget";
    await fetch("/api/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, target }),
    });
    setShowForm(false);
    setEditTarget(undefined);
    onRefresh();
  };

  const handleDelete = async (targetId: string) => {
    if (!confirm("确认删除该目标？")) return;
    await fetch("/api/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "deleteTarget", targetId }),
    });
    onRefresh();
  };

  return (
    <div>
      <div className={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span className={styles.cardTitle} style={{ marginBottom: 0 }}>转发目标</span>
          <button className="btnPrimary btnSm" onClick={() => { setEditTarget(undefined); setShowForm(true); }}>
            + 添加目标
          </button>
        </div>

        {config.targets.length === 0 ? (
          <p className="empty">暂无目标，点击"添加目标"开始配置</p>
        ) : (
          <div className={styles.targetList}>
            {config.targets.map((t) => (
              <div key={t.id} className={`${styles.targetItem}${t.id === config.activeTarget ? ` ${styles.active}` : ""}`}>
                <div style={{ flex: "none" }}>
                  <input
                    type="radio"
                    name="active"
                    checked={t.id === config.activeTarget}
                    onChange={() => handleSetActive(t.id)}
                  />
                </div>
                <span className={styles.targetName}>{t.name}</span>
                <span className={styles.targetUrl}>{t.url}</span>
                <div className={styles.targetActions}>
                  <button
                    className="btnGhost btnSm"
                    onClick={() => { setEditTarget(t); setShowForm(true); }}
                  >
                    编辑
                  </button>
                  <button
                    className="btnGhost btnSm"
                    onClick={() => {
                      setEditTarget({ ...t, id: "", name: `${t.name} (副本)` });
                      setShowForm(true);
                    }}
                  >
                    复制
                  </button>
                  <button className="btnDanger btnSm" onClick={() => handleDelete(t.id)}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.card}>
        <p className={styles.cardTitle}>日志采集配置</p>
        <p style={{ color: "#6b7280", fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          控制日志中存储的数据范围。关闭可选项可显著减小日志文件体积（最多保留 300 条）。
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={logCollection.captureOriginalBody}
              onChange={(e) => handleLogCollectionChange("captureOriginalBody", e.target.checked)}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <div>
              <span style={{ fontWeight: 500, fontSize: 13 }}>采集原始请求 Body</span>
              <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 2 }}>
                存储客户端发送的原始请求 Headers 和 Body（合并 bodyParams 之前的数据），用于 Diff 对比视图
              </p>
            </div>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={logCollection.captureRawStreamEvents}
              onChange={(e) => handleLogCollectionChange("captureRawStreamEvents", e.target.checked)}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <div>
              <span style={{ fontWeight: 500, fontSize: 13 }}>采集原始流式事件</span>
              <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 2 }}>
                存储流式响应的原始 SSE 事件数组（通常较大），可在响应体 Tab 中查看原始流式数据
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className={styles.card}>
        <p className={styles.cardTitle}>使用说明</p>
        <p style={{ color: "#6b7280", lineHeight: 1.7 }}>
          将客户端（如 OpenAI SDK）的 <code style={{ background: "#f3f4f6", padding: "1px 5px", borderRadius: 4 }}>base_url</code> 设置为：
        </p>
        <pre style={{ background: "#f3f4f6", padding: "10px 14px", borderRadius: 6, marginTop: 8, fontSize: 13 }}>
          http://localhost:1998/proxy
        </pre>
        <p style={{ color: "#6b7280", marginTop: 10, lineHeight: 1.7 }}>
          请求路径会直接拼接到选中目标的 Base URL 后，配置的 Headers 和 Body 参数会自动合并进每次请求。
        </p>
      </div>

      {showForm && (
        <TargetForm
          initial={editTarget}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditTarget(undefined); }}
        />
      )}
    </div>
  );
};

export default ConfigTab;
