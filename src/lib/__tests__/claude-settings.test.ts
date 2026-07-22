import {
  areManagedHooksCurrent,
  MANAGED_HOOK_EVENTS,
} from "../claude-settings";

const hookSet = (port: number) =>
  MANAGED_HOOK_EVENTS.map((event) => ({
    event,
    url: `http://localhost:${port}/api/hooks/${event}`,
  }));

describe("Claude hook status", () => {
  it("requires every managed hook on the current port", () => {
    expect(areManagedHooksCurrent(hookSet(1998), 1998)).toBe(true);
    expect(areManagedHooksCurrent(hookSet(1998).slice(1), 1998)).toBe(false);
    expect(areManagedHooksCurrent(hookSet(2998), 1998)).toBe(false);
  });

  it("treats stale managed duplicates as needing repair", () => {
    const events = [
      ...hookSet(1998),
      {
        event: MANAGED_HOOK_EVENTS[0],
        url: `http://localhost:2998/api/hooks/${MANAGED_HOOK_EVENTS[0]}`,
      },
    ];
    expect(areManagedHooksCurrent(events, 1998)).toBe(false);
  });
});
