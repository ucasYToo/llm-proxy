import type { Config } from "../../interfaces";
import {
  mergeConfig,
  sanitizeConfigForExport,
  validateConfigImport,
} from "../store";

const makeConfig = (): Config => ({
  activeTarget: "target-1",
  targets: [
    {
      id: "target-1",
      name: "Primary",
      url: "https://example.com/v1",
      headers: {
        Authorization: "Bearer header-secret",
        "X-API-Key": "header-api-key",
        "anthropic-version": "2023-06-01",
      },
      bodyParams: {},
      auth: { type: "bearer", value: "target-auth-secret" },
    },
  ],
  logCollection: {
    captureOriginalBody: false,
    captureRawStreamEvents: false,
  },
  channels: [
    {
      id: "default",
      name: "Default",
      activeTarget: "target-1",
      cwdRoutes: [{ cwd: "/tmp/project", targetId: "target-1" }],
    },
  ],
  claudeCodeChannelId: "default",
  notifications: {
    dingtalk: { enabled: true, accessToken: "ding-token", secret: "ding-secret" },
    feishu: { enabled: true, webhookUrl: "https://hook.example", secret: "hook-secret" },
  },
  remoteBridge: {
    enabled: true,
    authToken: "remote-auth-token",
    web: { enabled: true },
    feishu: {
      enabled: true,
      appId: "legacy-app",
      appSecret: "legacy-secret",
      encryptKey: "legacy-encrypt",
      verificationToken: "legacy-verify",
      bots: [
        {
          id: "bot-1",
          name: "Bot One",
          appId: "bot-app",
          appSecret: "bot-secret",
          encryptKey: "bot-encrypt",
          verificationToken: "bot-verify",
        },
      ],
    },
  },
});

describe("config export and import", () => {
  it("removes known credentials without mutating the live config", () => {
    const current = makeConfig();
    const exported = sanitizeConfigForExport(current);

    expect(exported.targets[0].auth?.value).toBe("");
    expect(exported.targets[0].headers.Authorization).toBe("");
    expect(exported.targets[0].headers["X-API-Key"]).toBe("");
    expect(exported.targets[0].headers["anthropic-version"]).toBe("2023-06-01");
    expect(exported.notifications?.dingtalk?.accessToken).toBeUndefined();
    expect(exported.notifications?.dingtalk?.secret).toBeUndefined();
    expect(exported.notifications?.feishu?.webhookUrl).toBeUndefined();
    expect(exported.remoteBridge?.authToken).toBeUndefined();
    expect(exported.remoteBridge?.feishu?.appSecret).toBeUndefined();
    expect(exported.remoteBridge?.feishu?.encryptKey).toBeUndefined();
    expect(exported.remoteBridge?.feishu?.verificationToken).toBeUndefined();
    expect(exported.remoteBridge?.feishu?.bots?.[0].appSecret).toBeUndefined();
    expect(exported.remoteBridge?.feishu?.bots?.[0].encryptKey).toBeUndefined();
    expect(exported.remoteBridge?.feishu?.bots?.[0].verificationToken).toBeUndefined();
    expect((exported as unknown as Record<string, unknown>).__exportedAt).toEqual(
      expect.any(String),
    );

    expect(current.targets[0].auth?.value).toBe("target-auth-secret");
    expect(current.remoteBridge?.feishu?.bots?.[0].appSecret).toBe("bot-secret");
  });

  it("restores local credentials during a sanitized round trip", () => {
    const current = makeConfig();
    const exported = sanitizeConfigForExport(current);
    exported.targets[0].name = "Renamed";
    exported.remoteBridge!.web = { enabled: false };

    const merged = mergeConfig(exported, current);

    expect(merged.targets[0].name).toBe("Renamed");
    expect(merged.targets[0].auth?.value).toBe("target-auth-secret");
    expect(merged.targets[0].headers.Authorization).toBe("Bearer header-secret");
    expect(merged.targets[0].headers["X-API-Key"]).toBe("header-api-key");
    expect(merged.notifications?.dingtalk?.accessToken).toBe("ding-token");
    expect(merged.notifications?.feishu?.webhookUrl).toBe("https://hook.example");
    expect(merged.remoteBridge?.authToken).toBe("remote-auth-token");
    expect(merged.remoteBridge?.web?.enabled).toBe(false);
    expect(merged.remoteBridge?.feishu?.appSecret).toBe("legacy-secret");
    expect(merged.remoteBridge?.feishu?.bots?.[0].appSecret).toBe("bot-secret");
    expect(merged.remoteBridge?.feishu?.bots?.[0].encryptKey).toBe("bot-encrypt");
    expect(merged.remoteBridge?.feishu?.bots?.[0].verificationToken).toBe("bot-verify");
  });

  it("accepts explicit replacement credentials but keeps the local bridge token", () => {
    const current = makeConfig();
    const imported = sanitizeConfigForExport(current);
    imported.targets[0].auth!.value = "replacement-target-token";
    imported.notifications!.dingtalk!.accessToken = "replacement-ding-token";
    imported.remoteBridge!.authToken = "replacement-bridge-token";
    imported.remoteBridge!.feishu!.bots![0].appSecret = "replacement-bot-secret";

    const merged = mergeConfig(imported, current);

    expect(merged.targets[0].auth?.value).toBe("replacement-target-token");
    expect(merged.notifications?.dingtalk?.accessToken).toBe("replacement-ding-token");
    expect(merged.remoteBridge?.authToken).toBe("remote-auth-token");
    expect(merged.remoteBridge?.feishu?.bots?.[0].appSecret).toBe(
      "replacement-bot-secret",
    );
  });

  it("does not restore credentials when the target endpoint or bot app changes", () => {
    const current = makeConfig();
    const imported = sanitizeConfigForExport(current);
    imported.targets[0].url = "https://different.example/v1";
    imported.remoteBridge!.feishu!.appId = "different-legacy-app";
    imported.remoteBridge!.feishu!.bots![0].appId = "different-bot-app";

    const merged = mergeConfig(imported, current);

    expect(merged.targets[0].auth?.value).toBe("");
    expect(merged.targets[0].headers.Authorization).toBe("");
    expect(merged.remoteBridge?.feishu?.appSecret).toBeUndefined();
    expect(merged.remoteBridge?.feishu?.bots?.[0].appSecret).toBeUndefined();
  });

  it("cleans dangling references from older configs before export", () => {
    const current = makeConfig();
    current.activeTarget = "removed-target";
    current.channels[0].activeTarget = "removed-target";
    current.channels[0].cwdRoutes = [
      { cwd: "/tmp/removed", targetId: "removed-target" },
    ];
    current.claudeCodeChannelId = "removed-channel";

    const exported = sanitizeConfigForExport(current);

    expect(exported.activeTarget).toBe("target-1");
    expect(exported.channels[0].activeTarget).toBe("");
    expect(exported.channels[0].cwdRoutes).toEqual([]);
    expect(exported.claudeCodeChannelId).toBeUndefined();
    expect(validateConfigImport(exported)).toBeNull();
  });

  it("rejects malformed configs and dangling target references", () => {
    const valid = makeConfig();
    expect(validateConfigImport(valid)).toBeNull();

    const dangling = makeConfig();
    dangling.channels[0].activeTarget = "missing";
    expect(validateConfigImport(dangling)).toContain("missing target");

    const malformed = makeConfig() as unknown as Record<string, unknown>;
    malformed.logCollection = { captureOriginalBody: "yes" };
    expect(validateConfigImport(malformed)).toContain("capture flags");
  });
});
