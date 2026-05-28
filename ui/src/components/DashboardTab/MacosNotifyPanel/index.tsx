import type { ChannelEvents } from "../../../lib/api";
import styles from "../index.module.css";

interface Props {
  events: ChannelEvents | undefined;
  onChange: (next: ChannelEvents) => void;
}

/** macOS 通知的事件勾选面板。token/secret 不需要，只有 3 个 checkbox。 */
const MacosNotifyPanel = ({ events, onChange }: Props) => {
  const { stop = false, subagentStop = false, notification = false } = events ?? {};
  return (
    <div className={styles.dingPanel}>
      <div className={styles.dingPanelHint}>
        选择 macOS 系统通知（含声音）要响应的 Claude Code hook 事件。
      </div>
      <div className={styles.notifyEventsRow}>
        <label className={styles.toggleChip}>
          <input
            type="checkbox"
            checked={stop}
            onChange={(e) => onChange({ stop: e.target.checked })}
          />
          Stop（任务完成）
        </label>
        <label className={styles.toggleChip}>
          <input
            type="checkbox"
            checked={subagentStop}
            onChange={(e) => onChange({ subagentStop: e.target.checked })}
          />
          SubagentStop（子代理完成）
        </label>
        <label className={styles.toggleChip}>
          <input
            type="checkbox"
            checked={notification}
            onChange={(e) => onChange({ notification: e.target.checked })}
          />
          Notification（Claude Code 通知）
        </label>
      </div>
    </div>
  );
};

export default MacosNotifyPanel;
