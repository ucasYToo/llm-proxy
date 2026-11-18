import type { useNotifications } from "../useNotifications";
import styles from "./index.module.css";

type Channel = "macos" | "dingtalk" | "feishu";
const channels: { key: Channel; name: string }[] = [
  { key: "macos", name: "macOS" },
  { key: "dingtalk", name: "钉钉" },
  { key: "feishu", name: "飞书" },
];
export function NotificationControls({
  notify,
  showMacos = true,
  showFeishu = true,
}: {
  notify: ReturnType<typeof useNotifications>;
  showMacos?: boolean;
  showFeishu?: boolean;
}) {
  const toggle = {
    macos: notify.handleToggleMacos,
    dingtalk: notify.handleToggleDingTalk,
    feishu: notify.handleToggleFeishu,
  };
  const armed = {
    macos: notify.macosArmed,
    dingtalk: notify.dingtalkArmed,
    feishu: notify.feishuArmed,
  };
  return (
    <div className={styles.controls} role="group" aria-label="通知">
      <span className={styles.caption}>通知</span>
      {channels
        .filter(
          (c) =>
            (c.key !== "macos" || showMacos) &&
            (c.key !== "feishu" || showFeishu),
        )
        .map(({ key, name }) => {
          const open = notify.open === key;
          return (
            <div
              key={key}
              className={styles.pair}
              data-open={open}
              role="group"
              aria-label={name + "通知"}
            >
              <label>
                <input
                  type="checkbox"
                  checked={!!notify[key].enabled}
                  onChange={(e) => void toggle[key](e.target.checked)}
                />
                {name}
                {notify[key].enabled && !armed[key] && (
                  <span className={styles.warning} title="请检查通知配置">
                    !
                  </span>
                )}
              </label>
              <button
                type="button"
                aria-label={name + "通知配置"}
                aria-expanded={open}
                onClick={() => notify.setOpen(open ? null : key)}
              >
                {open ? "收起" : "配置"}
              </button>
            </div>
          );
        })}
    </div>
  );
}
