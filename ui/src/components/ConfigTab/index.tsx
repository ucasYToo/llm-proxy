import { useState } from "react";
import type { Config, Target, LogCollection, Channel } from "../../lib/api";
import { applyClaudeCodeProxy, restoreClaudeCodeProxy, refreshClaudeCodeStatus, addChannel, updateChannel, deleteChannel, setChannelActiveTarget } from "../../lib/api";
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
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [editChannelId, setEditChannelId] = useState<string | undefined>();
  const [editChannelName, setEditChannelName] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelId, setNewChannelId] = useState("");

  const channels = config.channels ?? [];
  const port = config.serverPort ?? 1998;

  const isProxyApplied = !!config.claudeCodeChannelId;

  const handleApplyProxy = async (channelId: string) => {
    const channelName = config.channels?.find((c) => c.id === channelId)?.name ?? channelId;
    const isUpdate = isProxyApplied && config.claudeCodeChannelId === channelId;
    const msg = isUpdate
      ? `将重新写入通道「${channelName}」的代理配置到 Claude Code（会更新 ANTHROPIC_MODEL 等），确认继续？`
      : `将把 Claude Code 的 ANTHROPIC_BASE_URL 切换为通道「${channelName}」的代理地址，确认继续？`;
    if (!confirm(msg)) return;
    setClaudeCodeLoading(true);
    try {
      await applyClaudeCodeProxy(channelId);
      onRefresh();
    } catch (e) {
      alert("操作失败：" + String(e));
    } finally {
      setClaudeCodeLoading(false);
    }
  };

  const handleRestoreProxy = async (channelId: string) => {
    const channel = config.channels?.find((c) => c.id === channelId);
    const target = channel
      ? config.targets.find((t) => t.id === channel.activeTarget)
      : undefined;
    if (!target) {
      alert(`通道「${channel?.name ?? channelId}」未选择活动目标，无法直连。`);
      return;
    }
    const modelInfo = target.anthropicModel ? `，model = ${target.anthropicModel}` : "";
    if (!confirm(`将把 Claude Code 的 ANTHROPIC_BASE_URL 改为 ${target.url}${modelInfo}（直连，跳过本代理），确认继续？`)) return;
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

  const handleRefreshStatus = async () => {
    setClaudeCodeLoading(true);
    setRefreshMsg(null);
    try {
      const result = await refreshClaudeCodeStatus();
      if (result.detected) {
        const channelName = config.channels?.find((c) => c.id === result.channelId)?.name ?? result.channelId;
        const modelInfo = result.currentModel ? `，模型: ${result.currentModel}` : "";
        setRefreshMsg(`检测到 Claude Code 已接入通道「${channelName}」${modelInfo}`);
      } else {
        setRefreshMsg(result.currentUrl
          ? `Claude Code 当前 ANTHROPIC_BASE_URL 未指向本代理（${result.currentUrl}）`
          : "Claude Code 未设置 ANTHROPIC_BASE_URL，未接入代理");
      }
      onRefresh();
    } catch (e) {
      setRefreshMsg("刷新失败：" + String(e));
    } finally {
      setClaudeCodeLoading(false);
    }
  };

  const logCollection: LogCollection = config.logCollection ?? {
    captureOriginalBody: false,
    captureRawStreamEvents: false,
  };

  const handleLogCollectionChange = async <K extends keyof LogCollection>(
    key: K,
    value: LogCollection[K],
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
      {/* 转发目标 */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>转发目标</span>
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
                className={`${styles.targetRow}${t.id === config.activeTarget ? ` ${styles.active}` : ""}`}
              >
                <input
                  type="radio"
                  name="active"
                  checked={t.id === config.activeTarget}
                  onChange={() => handleSetActive(t.id)}
                  className={styles.targetRadio}
                />
                <span className={styles.targetName}>{t.name}</span>
                <span className={styles.targetUrl}>{t.url}</span>
                <span className={styles.modelBadge}>{t.anthropicModel || ''}</span>
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

      {/* 通道管理 */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>通道管理</span>
          <div className={styles.headerActions}>
            <button
              className="btnGhost btnSm"
              onClick={handleRefreshStatus}
              disabled={claudeCodeLoading}
              title="读取 ~/.claude/settings.json 检测实际接入状态"
            >
              {claudeCodeLoading ? "检测中…" : "刷新状态"}
            </button>
            <button
              className="btnPrimary btnSm"
              onClick={() => setShowChannelForm(true)}
            >
              + 添加通道
            </button>
          </div>
        </div>

        {refreshMsg && (
          <p className={refreshMsg.startsWith("检测到") ? styles.alertSuccess : styles.alertInfo}>
            {refreshMsg}
          </p>
        )}

        <p className={styles.hint}>
          每个通道可以独立选择活动目标，通过不同的 URL 路径区分（如 <code>/default/proxy</code>）。
        </p>

        {showChannelForm && (
          <div className={styles.inlineForm}>
            <div className={styles.inlineFormRow}>
              <input
                type="text"
                placeholder="通道名称（如：通义千问）"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddChannel()}
                autoFocus
              />
              <input
                type="text"
                placeholder="通道 ID（可选，如：qwen）"
                value={newChannelId}
                onChange={(e) => setNewChannelId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddChannel()}
              />
            </div>
            <div className={styles.inlineFormActions}>
              <span className={styles.inlineFormHint}>
                通道 ID 将用于 URL 路径（如 /qwen/proxy），只允许字母、数字、连字符和下划线，不填则自动生成
              </span>
              <div className={styles.inlineFormButtons}>
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
          <div className={styles.channelList}>
            {channels.map((ch) => {
              const activeTarget = config.targets.find((t) => t.id === ch.activeTarget);
              const isThisChannelApplied = isProxyApplied && config.claudeCodeChannelId === ch.id;
              const proxyUrl = ch.id === "default"
                ? `http://localhost:${port}/proxy`
                : `http://localhost:${port}/${ch.id}/proxy`;
              return (
                <div key={ch.id} className={`${styles.channelCard}${isThisChannelApplied ? ` ${styles.connected}` : ""}`}>
                  <div className={styles.channelHeader}>
                    {editChannelId === ch.id ? (
                      <div className={styles.editChannelRow}>
                        <input
                          type="text"
                          value={editChannelName}
                          onChange={(e) => setEditChannelName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleUpdateChannelName(ch);
                            if (e.key === "Escape") cancelEditChannel();
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
                      <>
                        <div className={styles.channelTitleRow}>
                          <span className={styles.channelName}>{ch.name}</span>
                          {isThisChannelApplied && (
                            <span className={styles.statusBadge}>Claude Code 已接入</span>
                          )}
                        </div>
                        <div className={styles.channelActions}>
                          <button
                            className="btnGhost btnSm"
                            onClick={() => handleApplyProxy(ch.id)}
                            disabled={claudeCodeLoading}
                            title={
                              isThisChannelApplied
                                ? "重新写入代理配置（用于更新 ANTHROPIC_MODEL 等）"
                                : isProxyApplied
                                  ? `当前已接入其他通道，点击切换到「${ch.name}」`
                                  : `将 Claude Code 接入此通道`
                            }
                          >
                            {claudeCodeLoading ? "接入中…" : isThisChannelApplied ? "更新接入" : "接入 Claude Code"}
                          </button>
                          {isThisChannelApplied && (
                            <button
                              className="btnGhost btnSm"
                              onClick={() => handleRestoreProxy(ch.id)}
                              disabled={claudeCodeLoading}
                              title={
                                activeTarget
                                  ? `将 Claude Code 切到直连：${activeTarget.url}${activeTarget.anthropicModel ? ` (${activeTarget.anthropicModel})` : ""}`
                                  : "通道未选择活动目标，无法直连"
                              }
                            >
                              {claudeCodeLoading ? "切换中…" : "直连"}
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
                      </>
                    )}
                  </div>

                  {editChannelId !== ch.id && (
                    <>
                      <div className={styles.channelBody}>
                        <div className={styles.channelField}>
                          <span className={styles.channelFieldLabel}>活动目标</span>
                          <select
                            value={ch.activeTarget}
                            onChange={(e) => handleSetChannelActive(ch.id, e.target.value)}
                          >
                            <option value="">未选择</option>
                            {config.targets.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                          {activeTarget && (
                            <span className={styles.targetUrl}>{activeTarget.url}</span>
                          )}
                          {activeTarget?.anthropicModel && (
                            <span className={styles.modelBadge}>{activeTarget.anthropicModel}</span>
                          )}
                        </div>
                      </div>
                      <div className={styles.channelFooter}>
                        <span className={styles.proxyUrl}>{proxyUrl}</span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 日志采集配置 */}
      <div className={styles.section}>
        <p className={styles.sectionTitle}>日志采集配置</p>
        <p className={styles.hint}>
          控制日志中存储的数据范围与上限。日志存储已迁移到 SQLite（~/.claude-proxy/logs.db）。
        </p>
        <div className={styles.maxEntriesRow}>
          <label htmlFor="maxEntries">最大保留条数</label>
          <input
            id="maxEntries"
            type="number"
            min={1}
            max={100000}
            defaultValue={logCollection.maxEntries ?? 300}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n) || n < 1) return;
              if (n === (logCollection.maxEntries ?? 300)) return;
              handleLogCollectionChange("maxEntries", n);
            }}
          />
          <span className={styles.toggleDesc}>超过将按 timestamp 倒序删除最旧的记录</span>
        </div>
        <div className={styles.toggleList}>
          <label className={styles.toggleItem}>
            <input
              type="checkbox"
              checked={logCollection.captureOriginalBody}
              onChange={(e) =>
                handleLogCollectionChange("captureOriginalBody", e.target.checked)
              }
            />
            <div>
              <div className={styles.toggleLabel}>采集原始请求 Body</div>
              <div className={styles.toggleDesc}>
                存储客户端发送的原始请求 Headers 和 Body（合并 bodyParams 之前的数据），用于 Diff 对比视图
              </div>
            </div>
          </label>
          <label className={styles.toggleItem}>
            <input
              type="checkbox"
              checked={logCollection.captureRawStreamEvents}
              onChange={(e) =>
                handleLogCollectionChange("captureRawStreamEvents", e.target.checked)
              }
            />
            <div>
              <div className={styles.toggleLabel}>采集原始流式事件</div>
              <div className={styles.toggleDesc}>
                存储流式响应的原始 SSE 事件数组（通常较大），可在响应体 Tab 中查看原始流式数据
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* 使用说明 */}
      <div className={styles.section}>
        <p className={styles.sectionTitle}>使用说明</p>
        <p className={styles.guideText}>
          将客户端（如 OpenAI SDK）的 <code>base_url</code> 设置为对应通道的代理地址：
        </p>
        <div className={styles.codeBlockGroup}>
          <div>
            <div className={styles.codeBlockLabel}>默认通道（向后兼容）</div>
            <pre className={styles.codeBlock}>http://localhost:{port}/proxy</pre>
          </div>
          <div>
            <div className={styles.codeBlockLabel}>指定通道（推荐）</div>
            <pre className={styles.codeBlock}>http://localhost:{port}/{"{channelId}"}/proxy</pre>
          </div>
        </div>
        <p className={styles.guideFooter}>
          请求路径会直接拼接到该通道选中目标的 Base URL 后，配置的 Headers 和 Body 参数会自动合并进每次请求。
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
