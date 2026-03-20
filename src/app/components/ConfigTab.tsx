"use client";
import { useState } from "react";
import type { Config, Target } from "@/lib/types";
import TargetForm from "./TargetForm";

interface Props {
  config: Config;
  onRefresh: () => void;
}

export default function ConfigTab({ config, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Target | undefined>();

  async function handleSetActive(targetId: string) {
    await fetch("/api/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "setActive", targetId }),
    });
    onRefresh();
  }

  async function handleSave(target: Omit<Target, "id"> & { id?: string }) {
    const action = target.id ? "updateTarget" : "addTarget";
    await fetch("/api/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, target }),
    });
    setShowForm(false);
    setEditTarget(undefined);
    onRefresh();
  }

  async function handleDelete(targetId: string) {
    if (!confirm("确认删除该目标？")) return;
    await fetch("/api/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "deleteTarget", targetId }),
    });
    onRefresh();
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span className="card-title" style={{ marginBottom: 0 }}>转发目标</span>
          <button className="btn-primary btn-sm" onClick={() => { setEditTarget(undefined); setShowForm(true); }}>
            + 添加目标
          </button>
        </div>

        {config.targets.length === 0 ? (
          <p className="empty">暂无目标，点击"添加目标"开始配置</p>
        ) : (
          <div className="target-list">
            {config.targets.map((t) => (
              <div key={t.id} className={`target-item${t.id === config.activeTarget ? " active" : ""}`}>
                <div style={{ flex: "none" }}>
                  <input
                    type="radio"
                    name="active"
                    checked={t.id === config.activeTarget}
                    onChange={() => handleSetActive(t.id)}
                  />
                </div>
                <span className="target-name">{t.name}</span>
                <span className="target-url">{t.url}</span>
                <div className="target-actions">
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => { setEditTarget(t); setShowForm(true); }}
                  >
                    编辑
                  </button>
                  <button className="btn-danger btn-sm" onClick={() => handleDelete(t.id)}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <p className="card-title">使用说明</p>
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
}
