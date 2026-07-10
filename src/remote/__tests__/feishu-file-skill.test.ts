import fs from "fs";
import os from "os";
import path from "path";

import { resolveRemoteFeishuFile } from "../feishu-file";
import {
  FEISHU_REMOTE_SKILL_VERSION,
  getFeishuRemoteSkillStatus,
  installFeishuRemoteSkill,
  uninstallFeishuRemoteSkill,
} from "../feishu-skill";

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-proxy-feishu-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("feishu remote file resolver", () => {
  test("resolves relative files inside the remote cwd", () => {
    const cwd = makeTempDir();
    const file = path.join(cwd, "report.txt");
    fs.writeFileSync(file, "hello", "utf-8");

    const resolved = resolveRemoteFeishuFile({
      thread: { cwd },
      filePath: "report.txt",
      displayName: "final.txt",
    });

    expect(resolved.filePath).toBe(fs.realpathSync.native(file));
    expect(resolved.displayName).toBe("final.txt");
    expect(resolved.sizeBytes).toBe(5);
  });

  test("rejects files outside the remote cwd", () => {
    const cwd = makeTempDir();
    const outside = path.join(makeTempDir(), "secret.txt");
    fs.writeFileSync(outside, "nope", "utf-8");

    expect(() =>
      resolveRemoteFeishuFile({
        thread: { cwd },
        filePath: outside,
      }),
    ).toThrow("inside the remote thread project directory");
  });
});

describe("feishu remote skill installer", () => {
  test("installs, reports and uninstalls the managed skill", () => {
    const cwd = makeTempDir();

    expect(getFeishuRemoteSkillStatus({ cwd }).installed).toBe(false);

    const installed = installFeishuRemoteSkill({
      cwd,
      botId: "bot-a",
      botName: "Bot A",
    }).status;

    expect(installed.installed).toBe(true);
    expect(installed.version).toBe(FEISHU_REMOTE_SKILL_VERSION);
    expect(installed.needsUpdate).toBe(false);
    expect(installed.skillPath).toBeTruthy();
    expect(installed.helperPath).toBeTruthy();
    expect(fs.readFileSync(installed.skillPath ?? "", "utf-8")).toContain(
      FEISHU_REMOTE_SKILL_VERSION,
    );
    expect(fs.readFileSync(installed.helperPath ?? "", "utf-8")).toContain(
      "/api/remote/feishu/send-file",
    );

    const removed = uninstallFeishuRemoteSkill({
      cwd,
      botId: "bot-a",
      botName: "Bot A",
    }).status;

    expect(removed.installed).toBe(false);
  });

  test("reports a managed skill with a missing helper as needing update", () => {
    const cwd = makeTempDir();
    const installed = installFeishuRemoteSkill({ cwd }).status;

    fs.rmSync(installed.helperPath ?? "");
    const status = getFeishuRemoteSkillStatus({ cwd });

    expect(status.installed).toBe(true);
    expect(status.needsUpdate).toBe(true);
  });

  test("rejects a non-empty skill directory that is not managed", () => {
    const cwd = makeTempDir();
    const skillDir = path.join(cwd, ".claude", "skills", "feishu-remote");
    const userFile = path.join(skillDir, "user-owned.txt");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(userFile, "keep", "utf-8");

    expect(() => installFeishuRemoteSkill({ cwd })).toThrow(
      "is not managed by claude-proxy",
    );
    expect(fs.readFileSync(userFile, "utf-8")).toBe("keep");
  });

  test("uninstall removes only managed files", () => {
    const cwd = makeTempDir();
    const installed = installFeishuRemoteSkill({ cwd }).status;
    const skillDir = path.dirname(installed.skillPath ?? "");
    const userFile = path.join(skillDir, "user-owned.txt");
    fs.writeFileSync(userFile, "keep", "utf-8");

    const removed = uninstallFeishuRemoteSkill({ cwd }).status;

    expect(fs.existsSync(installed.skillPath ?? "")).toBe(false);
    expect(fs.existsSync(installed.helperPath ?? "")).toBe(false);
    expect(fs.readFileSync(userFile, "utf-8")).toBe("keep");
    expect(removed.installed).toBe(false);
  });
});
