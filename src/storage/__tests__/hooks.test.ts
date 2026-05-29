import {
  computeActivityState,
  isApprovalNotification,
  type SessionLatest,
} from "../hooks";

const SEC = 1000;
const MIN = 60 * SEC;

const session = (
  eventName: string,
  ageMs: number,
  extra: Partial<SessionLatest> = {},
): SessionLatest => ({
  eventName,
  message: null,
  notificationType: null,
  ageMs,
  ...extra,
});

describe("isApprovalNotification", () => {
  it("命中工具授权消息", () => {
    expect(
      isApprovalNotification("Claude needs your permission to use Bash"),
    ).toBe(true);
  });

  it("空闲等待输入不算授权", () => {
    expect(isApprovalNotification("Claude is waiting for your input")).toBe(
      false,
    );
  });

  it("notification_type 兜底匹配", () => {
    expect(isApprovalNotification(null, "permission_request")).toBe(true);
    expect(isApprovalNotification(null, "idle")).toBe(false);
  });

  it("approval 关键字（消息或类型）命中", () => {
    expect(isApprovalNotification("Claude needs your approval")).toBe(true);
    expect(isApprovalNotification(null, "approval_required")).toBe(true);
  });

  it("含 tool 的类型不再误判为授权（H1 回归）", () => {
    expect(isApprovalNotification(null, "tool_result")).toBe(false);
    expect(isApprovalNotification("ran a tool", "tool_use")).toBe(false);
  });

  it("message 为 null 且无 type 时为 false", () => {
    expect(isApprovalNotification(null)).toBe(false);
  });
});

describe("computeActivityState", () => {
  it("无会话且无结束记录 → idle", () => {
    const r = computeActivityState([], null);
    expect(r.state).toBe("idle");
    expect(r.blinking).toBe(false);
  });

  it("有运行中会话 → running 闪烁", () => {
    const r = computeActivityState([session("UserPromptSubmit", 5 * SEC)], null);
    expect(r.state).toBe("running");
    expect(r.blinking).toBe(true);
    expect(r.runningCount).toBe(1);
  });

  it("PostToolUse 也算运行中", () => {
    const r = computeActivityState([session("PostToolUse", 2 * SEC)], null);
    expect(r.state).toBe("running");
  });

  it("运行事件超过僵死阈值(15min) → 不算运行，回落 idle", () => {
    const r = computeActivityState([session("PreToolUse", 16 * MIN)], null);
    expect(r.state).toBe("idle");
    expect(r.runningCount).toBe(0);
  });

  it("SessionStart 不算运行（用户尚未提交）", () => {
    const r = computeActivityState([session("SessionStart", 1 * SEC)], null);
    expect(r.state).toBe("idle");
  });

  it("最新事件为授权通知 → approval 闪烁", () => {
    const r = computeActivityState(
      [
        session("Notification", 10 * SEC, {
          message: "Claude needs your permission to use Bash",
        }),
      ],
      null,
    );
    expect(r.state).toBe("approval");
    expect(r.blinking).toBe(true);
    expect(r.approvalCount).toBe(1);
  });

  it("空闲等待输入的通知不触发 approval", () => {
    const r = computeActivityState(
      [
        session("Notification", 10 * SEC, {
          message: "Claude is waiting for your input",
        }),
      ],
      null,
    );
    expect(r.state).toBe("idle");
    expect(r.approvalCount).toBe(0);
  });

  it("授权等待超过 60min → 视为僵死，不再 approval", () => {
    const r = computeActivityState(
      [
        session("Notification", 61 * MIN, {
          message: "Claude needs your permission to use Bash",
        }),
      ],
      null,
    );
    expect(r.state).toBe("idle");
  });

  it("刚结束 3 分钟内 → recent 常亮", () => {
    const r = computeActivityState([session("Stop", 1 * MIN)], 1 * MIN);
    expect(r.state).toBe("recent");
    expect(r.blinking).toBe(false);
  });

  it("结束超过 3 分钟 → idle", () => {
    const r = computeActivityState([session("Stop", 4 * MIN)], 4 * MIN);
    expect(r.state).toBe("idle");
  });

  it("优先级：审批 > 运行", () => {
    const r = computeActivityState(
      [
        session("UserPromptSubmit", 2 * SEC),
        session("Notification", 2 * SEC, {
          message: "Claude needs your permission to use Edit",
        }),
      ],
      null,
    );
    expect(r.state).toBe("approval");
    expect(r.runningCount).toBe(1);
    expect(r.approvalCount).toBe(1);
  });

  it("优先级：运行 > 刚结束", () => {
    const r = computeActivityState(
      [session("PostToolUse", 3 * SEC)],
      30 * SEC,
    );
    expect(r.state).toBe("running");
  });

  it("lastDoneAt 由调用方覆盖，纯函数内为 null", () => {
    const r = computeActivityState([], 30 * SEC);
    expect(r.lastDoneAt).toBeNull();
  });

  it("传入 nowMs 时 computedAt 确定（纯函数）", () => {
    const r = computeActivityState([], null, 1_700_000_000_000);
    expect(r.computedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });
});
