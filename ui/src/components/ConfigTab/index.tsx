import { useState } from "react";
import type { Config, Target, LogCollection, Channel } from "../../lib/api";
import { applyClaudeCodeProxy, restoreClaudeCodeProxy, addChannel, updateChannel, deleteChannel, setChannelActiveTarget } from "../../lib/api";
import TargetForm from "../TargetForm/index";
import styles from "./index.module.css";

interface Props {
  config: Config;
  onRefresh: () => void;
}

const ConfigTab = ({ config, onRefresh }: Props) => {
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Target | undefined>();
  const [claudeCodeLoading, setClaudeCodeLoading] = useState(false);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [editChannelId, setEditChannelId] = useState<string | undefined>();
  const [editChannelName, setEditChannelName] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelId, setNewChannelId] = useState("");

  const channels = config.channels ?? [];

  const isProxyApplied = !!config.claudeCodeOriginalBaseUrl;

  const handleApplyProxy = async (channelId: string) => {
    const channelName = config.channels?.find((c) => c.id === channelId)?.name ?? channelId;
    if (!confirm(`将把 Claude Code 的 ANTHROPIC_BASE_URL 切换为通道「${channelName}」的代理地址，确认继续？`)) return;
    setClaudeCodeLoading(true);
    try {
      await applyClaudeCodeProxy(1998, channelId);
      onRefresh();
    } catch (e) {
      alert("操作失败：" + String(e));
    } finally {
      setClaudeCodeLoading(false);
    }
  };

  const handleRestoreProxy = async () => {
    if (!confirm("将还原 Claude Code 的 ANTHROPIC_BASE_URL 为原始地址，确认继续？")) return;
    setClaudeCodeLoading(true);
    try {
      await restoreClaudeCodeProxy();
      onRefresh();
    } catch (e) {
      alert("操作失败：" + String(e));
    } finally {
      setClaudeCodeLoading(false);
    }
  };

  const logCollection: LogCollection = config.logCollection ?? {
    captureOriginalBody: false,
    captureRawStreamEvents: false,
  };

  const handleLogCollectionChange = async (
    key: keyof LogCollection,
    value: boolean,
  ) => {
    const updated = { ...logCollection, [key]: value };
    await fetch("/api/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "updateLogCollection",
        logCollection: updated,
      }),
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

  const handleAddChannel = async () => {
    if (!newChannelName.trim()) {
      alert("请输入通道名称");
      return;
    }
    try {
      const channelData: { name: string; activeTarget: string; id?: string } = {
        name: newChannelName.trim(),
        activeTarget: "",
      };
      if (newChannelId.trim()) {
        channelData.id = newChannelId.trim();
      }
      await addChannel(channelData);
      setNewChannelName("");
      setNewChannelId("");
      setShowChannelForm(false);
      onRefresh();
    } catch (e) {
      alert("添加通道失败：" + String(e));
    }
  };

  const handleDeleteChannel = async (channelId: string) => {
    if (!confirm("确认删除该通道？")) return;
    try {
      await deleteChannel(channelId);
      onRefresh();
    } catch (e) {
      alert("删除通道失败：" + String(e));
    }
  };

  const handleSetChannelActive = async (channelId: string, targetId: string) => {
    try {
      await setChannelActiveTarget(channelId, targetId);
      onRefresh();
    } catch (e) {
      alert("设置失败：" + String(e));
    }
  };

  const handleUpdateChannelName = async (channel: Channel) => {
    if (!editChannelName.trim()) return;
    try {
      await updateChannel({ ...channel, name: editChannelName.trim() });
      setEditChannelId(undefined);
      setEditChannelName("");
      onRefresh();
    } catch (e) {
      alert("更新通道失败：" + String(e));
    }
  };

  const startEditChannel = (channel: Channel) => {
    setEditChannelId(channel.id);
    setEditChannelName(channel.name);
  };

  const cancelEditChannel = () => {
    setEditChannelId(undefined);
    setEditChannelName("");
  };

  return (
    <div>
      <div className={styles.card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <span className={styles.cardTitle} style={{ marginBottom: 0 }}>
            转发目标
          </span>
          <button
            className="btnPrimary btnSm"
            onClick={() => {
              setEditTarget(undefined);
              setShowForm(true);
            }}
          >
            + 添加目标
          </button>
        </div>

        {config.targets.length === 0 ? (
          <p className="empty">暂无目标，点击"添加目标"开始配置</p>
        ) : (
          <div className={styles.targetList}>
            {config.targets.map((t) => (
              <div
                key={t.id}
                className={`${styles.targetItem}${t.id === config.activeTarget ? ` ${styles.active}` : ""}`}
              >
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
                    onClick={() => {
                      setEditTarget(t);
                      setShowForm(true);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="btnGhost btnSm"
                    onClick={() => {
                      setEditTarget({
                        ...t,
                        id: "",
                        name: `${t.name} (副本)`,
                      } as Target);
                      setShowForm(true);
                    }}
                  >
                    复制
                  </button>
                  <button
                    className="btnDanger btnSm"
                    onClick={() => handleDelete(t.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <span className={styles.cardTitle} style={{ marginBottom: 0 }}>
            通道管理
          </span>
          <button
            className="btnPrimary btnSm"
            onClick={() => setShowChannelForm(true)}
          >
            + 添加通道
          </button>
        </div>
        <p style={{ color: "#6b7280", fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          每个通道可以独立选择活动目标，通过不同的 URL 路径区分（如{" "}
          <code style={{ background: "#f3f4f6", padding: "1px 5px", borderRadius: 4 }}>
            /default/proxy
          </code>
          ）。
        </p>

        {showChannelForm && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginBottom: 12,
              padding: "10px 12px",
              background: "#f9fafb",
              borderRadius: 6,
              border: "1px solid #e5e7eb",
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder="通道名称（如：通义千问）"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddChannel()}
                style={{
                  flex: 1,
                  padding: "4px 8px",
                  border: "1px solid #d1d5db",
                  borderRadius: 4,
                  fontSize: 13,
                }}
                autoFocus
              />
              <input
                type="text"
                placeholder="通道 ID（可选，如：qwen）"
                value={newChannelId}
                onChange={(e) => setNewChannelId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddChannel()}
                style={{
                  flex: 1,
                  padding: "4px 8px",
                  border: "1px solid #d1d5db",
                  borderRadius: 4,
                  fontSize: 13,
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>
                通道 ID 将用于 URL 路径（如 /qwen/proxy），只允许字母、数字、连字符和下划线，不填则自动生成
              </span>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button className="btnPrimary btnSm" onClick={handleAddChannel}>
                  确认
                </button>
                <button
                  className="btnGhost btnSm"
                  onClick={() => {
                    setShowChannelForm(false);
                    setNewChannelName("");
                    setNewChannelId("");
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {channels.length === 0 ? (
          <p className="empty">暂无通道，点击"添加通道"开始配置</p>
        ) : (
          <div className={styles.targetList}>
            {channels.map((ch) => {
              const activeTarget = config.targets.find((t) => t.id === ch.activeTarget);
              const isThisChannelApplied = isProxyApplied && config.claudeCodeChannelId === ch.id;
              const proxyUrl = ch.id === "default"
                ? "http://localhost:1998/proxy"
                : `http://localhost:1998/${ch.id}/proxy`;
              return (
                <div key={ch.id} className={styles.targetItem}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editChannelId === ch.id ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="text"
                          value={editChannelName}
                          onChange={(e) => setEditChannelName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleUpdateChannelName(ch);
                            if (e.key === "Escape") cancelEditChannel();
                          }}
                          style={{
                            padding: "2px 6px",
                            border: "1px solid #d1d5db",
                            borderRadius: 4,
                            fontSize: 13,
                          }}
                          autoFocus
                        />
                        <button
                          className="btnPrimary btnSm"
                          onClick={() => handleUpdateChannelName(ch)}
                        >
                          保存
                        </button>
                        <button
                          className="btnGhost btnSm"
                          onClick={cancelEditChannel}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className={styles.targetName}>{ch.name}</span>
                        {isThisChannelApplied && (
                          <span className="statusOk" style={{ fontSize: 11 }}>● Claude Code 已接入</span>
                        )}
                      </div>
                    )}
                    <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: "#6b7280" }}>活动目标：</span>
                      <select
                        value={ch.activeTarget}
                        onChange={(e) => handleSetChannelActive(ch.id, e.target.value)}
                        style={{
                          fontSize: 12,
                          padding: "2px 6px",
                          border: "1px solid #d1d5db",
                          borderRadius: 4,
                          background: "#fff",
                        }}
                      >
                        <option value="">未选择</option>
                        {config.targets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      {activeTarget && (
                        <span style={{ fontSize: 11, color: "#9ca3af" }}>
                          {activeTarget.url}
                        </span>
                      )}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <code style={{ fontSize: 11, color: "#9ca3af", background: "#f3f4f6", padding: "1px 5px", borderRadius: 4 }}>
                        {proxyUrl}
                      </code>
                    </div>
                  </div>
                  <div className={styles.targetActions}>
                    {isThisChannelApplied ? (
                      <button
                        className="btnGhost btnSm"
                        onClick={handleRestoreProxy}
                        disabled={claudeCodeLoading}
                      >
                        {claudeCodeLoading ? "还原中…" : "还原 Claude Code"}
                      </button>
                    ) : (
                      <button
                        className="btnGhost btnSm"
                        onClick={() => handleApplyProxy(ch.id)}
                        disabled={claudeCodeLoading}
                        title={isProxyApplied ? `当前已接入其他通道，点击切换到「${ch.name}」` : `将 Claude Code 接入此通道`}
                      >
                        {claudeCodeLoading ? "接入中…" : "接入 Claude Code"}
                      </button>
                    )}
                    <button
                      className="btnGhost btnSm"
                      onClick={() => startEditChannel(ch)}
                    >
                      重命名
                    </button>
                    {ch.id !== "default" && (
                      <button
                        className="btnDanger btnSm"
                        onClick={() => handleDeleteChannel(ch.id)}
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.card}>
        <p className={styles.cardTitle}>日志采集配置</p>
        <p
          style={{
            color: "#6b7280",
            fontSize: 12,
            marginBottom: 12,
            lineHeight: 1.6,
          }}
        >
          控制日志中存储的数据范围。关闭可选项可显著减小日志文件体积（最多保留
          300 条）。
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={logCollection.captureOriginalBody}
              onChange={(e) =>
                handleLogCollectionChange(
                  "captureOriginalBody",
                  e.target.checked,
                )
              }
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <div>
              <span style={{ fontWeight: 500, fontSize: 13 }}>
                采集原始请求 Body
              </span>
              <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 2 }}>
                存储客户端发送的原始请求 Headers 和 Body（合并 bodyParams
                之前的数据），用于 Diff 对比视图
              </p>
            </div>
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={logCollection.captureRawStreamEvents}
              onChange={(e) =>
                handleLogCollectionChange(
                  "captureRawStreamEvents",
                  e.target.checked,
                )
              }
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <div>
              <span style={{ fontWeight: 500, fontSize: 13 }}>
                采集原始流式事件
              </span>
              <p style={{ color: "#9ca3af", fontSize: 12, marginTop: 2 }}>
                存储流式响应的原始 SSE 事件数组（通常较大），可在响应体 Tab
                中查看原始流式数据
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className={styles.card}>
        <p className={styles.cardTitle}>使用说明</p>
        <p style={{ color: "#6b7280", lineHeight: 1.7 }}>
          将客户端（如 OpenAI SDK）的{" "}
          <code style={{ background: "#f3f4f6", padding: "1px 5px", borderRadius: 4 }}>
            base_url
          </code>{" "}
          设置为对应通道的代理地址：
        </p>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div>
            <p style={{ color: "#6b7280", fontSize: 12, marginBottom: 4 }}>默认通道（向后兼容）：</p>
            <pre style={{ background: "#f3f4f6", padding: "8px 12px", borderRadius: 6, fontSize: 13, margin: 0 }}>
              http://localhost:1998/proxy
            </pre>
          </div>
          <div>
            <p style={{ color: "#6b7280", fontSize: 12, marginBottom: 4 }}>指定通道（推荐）：</p>
            <pre style={{ background: "#f3f4f6", padding: "8px 12px", borderRadius: 6, fontSize: 13, margin: 0 }}>
              http://localhost:1998/{"{channelId}"}/proxy
            </pre>
          </div>
        </div>
        <p style={{ color: "#6b7280", marginTop: 10, lineHeight: 1.7, fontSize: 12 }}>
          请求路径会直接拼接到该通道选中目标的 Base URL 后，配置的 Headers 和 Body
          参数会自动合并进每次请求。
        </p>
      </div>

      {showForm && (
        <TargetForm
          initial={editTarget}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false);
            setEditTarget(undefined);
          }}
        />
      )}
    </div>
  );
};

export default ConfigTab;
