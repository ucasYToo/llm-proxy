import fs from "fs";
import os from "os";
import path from "path";
import {
  CODEX_HOOK_EVENTS,
  getCodexHookStatus,
  installCodexHooks,
  relayCodexHook,
  uninstallCodexHooks,
} from "../codex-hooks";

describe("Codex hook configuration", () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-hooks-"));
    file = path.join(directory, "hooks.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        custom: { retained: true },
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "user-owned-hook" }] },
          ],
        },
      }),
    );
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it("installs every event without replacing user handlers", () => {
    installCodexHooks(2998, { file, cliPath: "/tmp/cli.js" });
    const config = JSON.parse(fs.readFileSync(file, "utf-8"));

    expect(config.custom).toEqual({ retained: true });
    expect(config.hooks.SessionStart[0].hooks[0].command).toBe("user-owned-hook");
    for (const event of CODEX_HOOK_EVENTS) {
      expect(config.hooks[event]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            hooks: expect.arrayContaining([
              expect.objectContaining({
                type: "command",
                command: expect.stringContaining("codex hook relay --port 2998"),
              }),
            ]),
          }),
        ]),
      );
    }
    expect(getCodexHookStatus({ file }).installed).toBe(true);
  });

  it("uninstalls only managed handlers", () => {
    installCodexHooks(1998, { file, cliPath: "/tmp/cli.js" });
    uninstallCodexHooks({ file });
    const config = JSON.parse(fs.readFileSync(file, "utf-8"));

    expect(config.custom).toEqual({ retained: true });
    expect(config.hooks.SessionStart[0].hooks[0].command).toBe("user-owned-hook");
    expect(getCodexHookStatus({ file }).installed).toBe(false);
  });

  it("falls back across IPv6 and IPv4 loopback addresses", async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      await expect(
        relayCodexHook({
          port: 1998,
          payload: { hook_event_name: "UserPromptSubmit", prompt: "hello" },
        }),
      ).resolves.toBe(true);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "http://localhost:1998/api/codex/hooks/UserPromptSubmit",
        expect.any(Object),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "http://127.0.0.1:1998/api/codex/hooks/UserPromptSubmit",
        expect.any(Object),
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});
