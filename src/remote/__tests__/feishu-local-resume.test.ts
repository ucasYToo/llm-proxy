import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

test("Feishu quotes resume exactly one local session and the final text can be quoted again", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "feishu-resume-test-"));
  const env = { ...process.env };
  process.env.HOME = home;
  process.env.CLAUDE_CONFIG_DIR = path.join(home, ".claude");
  jest.resetModules();
  const handler: Record<string, Function> = {};
  const sent: { id: string; body: any }[] = [];
  const webhook = jest.fn(async () => ({ ok: true }));
  jest.doMock("../../notify/feishu", () => ({ sendFeishuText: webhook }));
  let server: Server | undefined;
  const run = jest.fn(async (input: any) => ({
    ok: true,
    text: "final " + input.prompt,
    sessionId: input.resumeSessionId,
    command: "claude",
  }));
  jest.doMock("../superagent", () => ({ bindSuperAgentClients: () => {} }));
  jest.doMock("../cli-runner", () => ({ runClaudePrint: run }));
  jest.doMock("@larksuiteoapi/node-sdk", () => ({
    AppType: { SelfBuild: 1 },
    Domain: { Feishu: 1 },
    LoggerLevel: { warn: 2 },
    EventDispatcher: class {
      register(events: object) {
        Object.assign(handler, events);
        return this;
      }
    },
    WSClient: class {
      start() {}
      close() {}
    },
    Client: class {
      im = {
        message: {
          create: async (req: any) => {
            const id = "om_" + (sent.length + 1);
            sent.push({ id, body: req.data });
            return { code: 0, data: { message_id: id } };
          },
          patch: async () => ({ code: 0 }),
        },
        v1: { message: { patch: async () => ({ code: 0 }) } },
      };
    },
  }));
  const bridge = require("../feishu") as typeof import("../feishu");
  const config =
    require("../../config/store") as typeof import("../../config/store");
  const db = require("../../storage/db") as typeof import("../../storage/db");
  try {
    const cfg = config.readConfig();
    cfg.remoteBridge = {
      ...cfg.remoteBridge,
      enabled: false,
      allowedCwds: [home],
      feishu: {
        enabled: true,
        bots: [
          {
            id: "main",
            appId: "app",
            appSecret: "test",
            defaultCwd: home,
            progressCard: { enabled: true },
            allowedUserIds: ["ou_owner"],
          },
        ],
      },
    };
    cfg.notifications = {
      feishu: {
        enabled: true,
        webhookUrl: "https://example.invalid/hook",
        events: { stop: true, notification: true },
      },
    };
    config.writeConfig(cfg);
    const app = express();
    app.use(express.json());
    require("../../server/management-routes").setupManagementRoutes(app);
    require("../../server/routes").setupApiRoutes(app);
    server = await new Promise<Server>((r) => {
      const s = app.listen(0, "127.0.0.1", () => r(s));
    });
    const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    const emit = async (payload: Record<string, unknown>, managed = true) => {
      const res = await fetch(
        origin + "/api/hooks/" + payload.hook_event_name,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(managed
              ? {
                  "X-Claude-Proxy-Hook":
                    require("../../lib/local-settings").hookKey(),
                }
              : {}),
          },
          body: JSON.stringify(payload),
        },
      );
      expect(res.ok).toBe(true);
    };
    bridge.startFeishuRemoteBridge();
    const set = (body: object, requestOrigin = origin) =>
      fetch(origin + "/api/set", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: requestOrigin },
        body: JSON.stringify(body),
      });
    const begin = { action: "pairFeishuNotification", botId: "main" };
    expect((await set(begin, "https://example.invalid")).status).toBe(403);
    const pairingResponse = await set(begin);
    expect(pairingResponse.ok).toBe(true);
    const pair = (await pairingResponse.json()) as { command: string };
    expect(pair.command).toMatch(/^\/bind /);
    const status = await (
      await fetch(origin + "/api/query?type=feishu-notification")
    ).json();
    expect(JSON.stringify(status)).not.toContain(pair.command);
    const receive = (
      text: string,
      id: string,
      parent?: string,
      sender = "ou_owner",
      chat = "p2p",
    ) =>
      handler["im.message.receive_v1"]({
        sender: { sender_type: "user", sender_id: { open_id: sender } },
        message: {
          chat_type: chat,
          chat_id: "chat",
          message_type: "text",
          message_id: id,
          parent_id: parent,
          content: JSON.stringify({ text }),
        },
      });
    await receive(pair.command!, "group-bind", undefined, "ou_owner", "group");
    await receive(pair.command!, "foreign-bind", undefined, "ou_other");
    expect(bridge.notificationBotsStatus().delivery).toBe("webhook");
    await receive(pair.command!, "bind");
    expect(bridge.notificationBotsStatus().bots[0].bound).toBe(true);
    expect(bridge.notificationBotsStatus().delivery).toBe("app");
    expect(handler["card.action.trigger"]).toBeUndefined();
    await bridge.testResumeBinding("main");
    expect(sent.at(-1)?.body.msg_type).toBe("text");
    const afterBinding = sent.length;
    await receive(pair.command!, "duplicate-bind");
    await receive("ordinary message", "not-a-quote");
    expect(sent).toHaveLength(afterBinding);
    expect(run).not.toHaveBeenCalled();
    const transcript = path.join(
      home,
      ".claude",
      "projects",
      "project",
      "sid.jsonl",
    );
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.writeFileSync(transcript, "");
    const stop = {
      hook_event_name: "Stop",
      session_id: "sid",
      transcript_path: transcript,
      cwd: home,
      last_assistant_message: "local answer",
      turn_id: "turn1",
    };
    await Promise.all([emit(stop), emit(stop)]);
    expect(webhook).not.toHaveBeenCalled();
    expect(
      sent.filter((item) => item.body.content.includes("local answer")),
    ).toHaveLength(1);
    const completion = sent.at(-1)!;
    expect(completion.body.msg_type).toBe("text");
    expect(JSON.parse(completion.body.content).text).toContain("点「回复」");
    expect(completion.body.content).toContain("local answer");
    const resume =
      require("../feishu/local-resume") as typeof import("../feishu/local-resume");
    const notice = resume.lookupNotice("main", completion.id, "").notice!;
    expect(completion.body.uuid).toEqual(notice.id);
    const other = {
      id: "second",
      appId: "other-app",
      localResume: {
        enabled: true,
        recipientOpenId: "ou_owner",
        defaultBot: true,
      },
    };
    const legacy = {
      ...other,
      localResume: { enabled: true, recipientOpenId: "ou_owner" },
    };
    expect(resume.botForCwd([legacy], home)).toBe(legacy);
    expect(
      resume.botForCwd([legacy, { ...legacy, id: "another" }], home),
    ).toBeUndefined();
    expect(
      resume.botForCwd(
        [
          {
            ...legacy,
            localResume: {
              ...legacy.localResume,
              projects: [path.join(home, "another")],
            },
          },
        ],
        home,
      ),
    ).toBeUndefined();
    resume.bindPrivateChat(other, "ou_owner", "chat");
    const copiedCode = resume.lookupNotice(
      other.id,
      null,
      "#续接-" + notice.id + " run tests",
    );
    expect(copiedCode.prompt).toBe("run tests");
    expect(
      resume.authorizedNotice(copiedCode.notice!, other, "ou_owner", "chat"),
    ).toBe(false);
    expect(
      resume.authorizedNotice(
        notice,
        { ...other, id: "main" },
        "ou_owner",
        "chat",
      ),
    ).toBe(false);
    expect(
      resume.matchesRecipient({ ...other, handler: "superagent" }, "ou_owner"),
    ).toBe(false);
    await bridge.handleLocalClaudeStop(stop);
    expect(sent.at(-1)!.id).toBe(completion.id);
    await receive("foreign", "wrong", completion.id, "ou_other");
    await receive("group", "group", completion.id, "ou_owner", "group");
    expect(run).not.toHaveBeenCalled();
    await Promise.all([
      receive("continue", "m1", completion.id),
      receive("continue", "m1", completion.id),
    ]);
    await new Promise((r) => setTimeout(r, 40));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].resumeSessionId).toBe("sid");
    const final = sent.filter(
      (s) =>
        s.body.msg_type === "text" && s.body.content.includes("final continue"),
    );
    expect(final).toHaveLength(1);
    await receive("again", "m2", final[0].id);
    for (
      let i = 0;
      i < 100 &&
      !sent.some(
        (s) =>
          s.body.msg_type === "text" && s.body.content.includes("final again"),
      );
      i++
    )
      await new Promise((r) => setTimeout(r, 20));
    expect({
      runs: run.mock.calls.length,
      states: db
        .getDb()
        .prepare("SELECT status FROM feishu_resume_notices ORDER BY rowid")
        .pluck()
        .all(),
      last: sent.at(-1)?.body.content,
    }).toEqual({
      runs: 2,
      states: ["consumed", "consumed", "pending"],
      last: expect.any(String),
    });
    await receive("old", "m3", completion.id);
    expect(run).toHaveBeenCalledTimes(2);
    await new Promise((r) => setTimeout(r, 250));
    await emit(
      { ...stop, hook_event_name: "Notification", message: "test-alert" },
      false,
    );
    expect(sent.at(-1)?.body.content).toContain("test-alert");
    expect(webhook).not.toHaveBeenCalled();
    const boundBot = config.readConfig().remoteBridge!.feishu!.bots![0];
    const recipient = { ...boundBot, id: "main", appId: "app" };
    // A restart can find both current text payloads and pending sends from the card UI.
    for (const legacyCard of [false, true]) {
      const turn = legacyCard ? "legacy-retry" : "text-retry";
      const offline = jest.fn(async () => {
        throw new Error("offline");
      });
      await expect(
        resume.localStop([recipient], { ...stop, turn_id: turn }, offline),
      ).rejects.toThrow("offline");
      const pending = db
        .getDb()
        .prepare("SELECT id, card FROM feishu_resume_notices WHERE turn=?")
        .get(turn) as { id: string; card: string };
      const text = JSON.parse(pending.card);
      const saved = legacyCard
        ? JSON.stringify({
            header: { title: { content: "Claude · saved" } },
            elements: [
              { tag: "div", text: { content: "saved answer" } },
              { tag: "action", actions: [{ tag: "button" }] },
            ],
          })
        : pending.card;
      db.getDb()
        .prepare("UPDATE feishu_resume_notices SET card=?,retryAt=0 WHERE id=?")
        .run(saved, pending.id);
      const resend = jest.fn(async () => "om_" + turn);
      await resume.retryNotices([recipient], resend);
      expect(resend).toHaveBeenCalledWith(
        expect.objectContaining({ id: pending.id }),
        legacyCard ? "Claude · saved\n\nsaved answer" : text,
      );
      expect(
        resume.lookupNotice("main", "om_" + turn, "").notice?.session,
      ).toBe("sid");
    }
    const updateFeishu = (feishu: object) =>
      set({ action: "updateNotifications", notifications: { feishu } });
    expect((await updateFeishu({ enabled: false })).ok).toBe(true);
    const count = sent.length;
    await emit({ ...stop, turn_id: "muted" });
    expect(sent).toHaveLength(count);
    expect(
      (await updateFeishu({ enabled: true, delivery: "webhook" })).ok,
    ).toBe(true);
    await emit({ ...stop, turn_id: "webhook-only" });
    expect(webhook).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(count);
    const newBot = await set({
      action: "pairFeishuNotification",
      appId: "cli_demo",
      appSecret: "fixture-secret",
    });
    expect(newBot.ok).toBe(true);
    const { botId } = await newBot.json();
    const publicConfig = await (
      await fetch(origin + "/api/query?type=config")
    ).json();
    expect(JSON.stringify(publicConfig)).not.toContain("fixture-secret");
    expect(
      (
        await set({
          action: "updateRemoteBridge",
          remoteBridge: publicConfig.remoteBridge,
        })
      ).ok,
    ).toBe(true);
    expect(
      config
        .readConfig()
        .remoteBridge?.feishu?.bots?.find((b) => b.id === botId),
    ).toMatchObject({ appSecret: "fixture-secret", notificationOnly: true });
    expect(config.readConfig().notifications?.feishu?.webhookUrl).toBe(
      "https://example.invalid/hook",
    );
  } finally {
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    bridge.stopFeishuRemoteBridge();
    db.closeDb();
    if (env.HOME) process.env.HOME = env.HOME;
    else delete process.env.HOME;
    if (env.CLAUDE_CONFIG_DIR)
      process.env.CLAUDE_CONFIG_DIR = env.CLAUDE_CONFIG_DIR;
    else delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
