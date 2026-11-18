import { useEffect, useState } from "react";
import { serviceAction } from "../../lib/api";

interface Status {
  manualUpdate: string;
  checkedAt: number | null;
  current: string;
  latest: string | null;
  available: boolean;
  canInstall: boolean;
  instanceId: string;
  error: string;
  phase: string;
}
async function status(): Promise<Status> {
  const res = await fetch("/api/query?type=update-status", {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error("读取版本失败");
  return res.json();
}
export function UpdateControl() {
  const [info, setInfo] = useState<Status>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void status()
        .then((s) => {
          if (active) setInfo(s);
        })
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function check() {
    setBusy("检查中…");
    setError("");
    try {
      setInfo(await serviceAction("checkUpdate"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function install() {
    if (!info?.latest) return;
    setBusy("正在安装…");
    setError("");
    try {
      await serviceAction("installUpdate", { version: info.latest });
      setBusy("等待服务重启…");
      for (let i = 0; i < 60; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const current = await status().catch(() => null);
        if (
          current?.current === info.latest &&
          current.instanceId !== info.instanceId
        ) {
          location.reload();
          return;
        }
      }
      throw new Error("服务未就绪，请查看 server.log");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
      <button
        className="btnGhost btnSm"
        title={
          info?.checkedAt
            ? "上次成功检查 " + new Date(info.checkedAt).toLocaleString()
            : "检查 npm 最新稳定版"
        }
        disabled={!!busy}
        onClick={check}
      >
        {busy || (info ? "v" + info.current + " · " : "") + "检查更新"}
      </button>
      {info?.available &&
        (info.canInstall ? (
          <button
            className="btnGhost btnSm"
            disabled={!!busy}
            onClick={install}
          >
            更新到 v{info.latest}
          </button>
        ) : (
          <small style={{ overflowWrap: "anywhere", userSelect: "all" }}>
            {info.manualUpdate}
          </small>
        ))}
      {(error || info?.error) && (
        <small role="status">{error || info?.error}</small>
      )}
    </div>
  );
}
