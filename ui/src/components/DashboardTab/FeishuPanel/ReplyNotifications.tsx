import { useEffect, useRef, useState } from "react";
import { serviceAction } from "../../../lib/api";
import styles from "../index.module.css";

interface Bot {
  id: string;
  name: string;
  bound: boolean;
  selected: boolean;
  notificationOnly: boolean;
}
interface Status {
  bots: Bot[];
  delivery: "app" | "webhook";
  pairingBot?: string;
}
interface Pair {
  botId: string;
  command: string;
  expiresAt: number;
}
async function status(): Promise<Status> {
  const res = await fetch("/api/query?type=feishu-notification", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("读取机器人配置失败");
  return res.json();
}

export function ReplyNotifications({ onRefresh }: { onRefresh: () => void }) {
  const [state, setState] = useState<Status>();
  const [id, setId] = useState("");
  const [appId, setAppId] = useState("");
  const [editCredentials, setEditCredentials] = useState(false);
  const [secret, setSecret] = useState("");
  const [pair, setPair] = useState<Pair>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    let active = true;
    status()
      .then((s) => {
        if (active) {
          setState(s);
          setId((s.bots.find((b) => b.selected) || s.bots[0])?.id ?? "");
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!pair) return;
    let active = true;
    const poll = async () => {
      try {
        const s = await status();
        if (!active) return;
        setState(s);
        if (s.pairingBot !== pair.botId || Date.now() >= pair.expiresAt) {
          setPair(undefined);
          if (
            s.delivery === "app" &&
            s.bots.some((b) => b.id === pair.botId && b.bound)
          ) {
            refresh.current();
            setMessage("");
          } else setMessage("绑定口令已失效，请重新生成");
        }
      } catch {
        /* Retry while waiting for the bot. */
      }
    };
    const timer = setInterval(poll, 1800);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pair]);
  const bot = state?.bots.find((b) => b.id === id);
  const bound = !!bot?.bound && state?.delivery === "app";
  async function connect(reuse = false) {
    setBusy(true);
    setMessage("");
    try {
      const result = await serviceAction(
        "pairFeishuNotification",
        bot && !editCredentials
          ? { botId: bot.id, reuseBinding: reuse }
          : { botId: bot?.id, appId: appId.trim(), appSecret: secret.trim() },
      );
      setSecret("");
      setEditCredentials(false);
      const s = await status();
      setState(s);
      setId(result.botId);
      if (result.command) setPair(result);
      else {
        setPair(undefined);
        refresh.current();
        setMessage("已启用可回复通知");
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setMessage("");
    try {
      await serviceAction("testResumeBinding", { botId: id });
      setMessage("测试通知已发送");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.replySettings}>
      <p className={styles.dingPanelHint}>
        任务完成后，在飞书私聊的通知消息上点「回复」，输入下一步指令即可继续原会话。
      </p>
      {state &&
        (state.bots.length > 0 && !editCredentials ? (
          <label className={styles.replyBot}>
            应用机器人
            {state.bots.length === 1 ? (
              <strong>{state.bots[0].name}</strong>
            ) : (
              <select
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setPair(undefined);
                  setMessage("");
                }}
              >
                {state.bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </label>
        ) : (
          <>
            <p className={styles.dingPanelHint}>
              使用启用了机器人和消息接收长连接的飞书自建应用。
            </p>
            <label className={styles.dingPanelRow}>
              <span className={styles.dingPanelLabel}>App ID</span>
              <input
                className={styles.dingPanelInput}
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
              />
            </label>
            <label className={styles.dingPanelRow}>
              <span className={styles.dingPanelLabel}>App Secret</span>
              <input
                className={styles.dingPanelInput}
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </label>
          </>
        ))}
      {bot?.notificationOnly && !bot.selected && !editCredentials && (
        <button
          type="button"
          className="btnGhost btnSm"
          onClick={() => {
            setPair(undefined);
            setEditCredentials(true);
            setMessage("");
          }}
        >
          修改应用凭据
        </button>
      )}
      {pair ? (
        <div className={styles.pairCommand}>
          <label>
            把这条口令私聊发给机器人（10 分钟内有效）
            <input
              readOnly
              value={pair.command}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            type="button"
            className="btnGhost btnSm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(pair.command);
                setMessage("已复制口令");
              } catch {
                setMessage("请选择并复制口令");
              }
            }}
          >
            复制口令
          </button>
        </div>
      ) : (
        <div className={styles.dingPanelActions}>
          {bound && <span>私聊已绑定</span>}
          {bound && (
            <button
              type="button"
              className="btnGhost btnSm"
              disabled={busy}
              onClick={test}
            >
              发送测试通知
            </button>
          )}
          <button
            type="button"
            className={bound ? "btnGhost btnSm" : "btnPrimary btnSm"}
            disabled={
              busy ||
              !state ||
              ((!bot || editCredentials) && !(appId.trim() && secret.trim()))
            }
            onClick={() => void connect(!!bot?.bound && !bound)}
          >
            {bound
              ? "重新绑定"
              : bot?.bound
                ? "使用已绑定私聊"
                : "绑定我的飞书"}
          </button>
        </div>
      )}
      {message && <small role="status">{message}</small>}
    </div>
  );
}
