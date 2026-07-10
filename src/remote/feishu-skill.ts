import fs from "fs";
import path from "path";

export const FEISHU_REMOTE_SKILL_VERSION = "1.0.0";
export const FEISHU_REMOTE_SKILL_NAME = "feishu-remote";
export const FEISHU_REMOTE_SKILL_REL_DIR = path.join(
  ".claude",
  "skills",
  FEISHU_REMOTE_SKILL_NAME,
);

const VERSION_MARKER = "claude-proxy-feishu-remote-skill-version";

export interface FeishuRemoteSkillStatus {
  botId?: string | null;
  botName?: string | null;
  cwd: string | null;
  installed: boolean;
  version: string | null;
  expectedVersion: string;
  needsUpdate: boolean;
  skillPath: string | null;
  helperPath: string | null;
  error?: string;
}

export interface InstallFeishuRemoteSkillResult {
  status: FeishuRemoteSkillStatus;
}

const skillDirForCwd = (cwd: string): string =>
  path.join(path.resolve(cwd), FEISHU_REMOTE_SKILL_REL_DIR);

const skillPathForCwd = (cwd: string): string =>
  path.join(skillDirForCwd(cwd), "SKILL.md");

const helperPathForCwd = (cwd: string): string =>
  path.join(skillDirForCwd(cwd), "scripts", "send-file.js");

const readVersion = (skillPath: string): string | null => {
  try {
    const content = fs.readFileSync(skillPath, "utf-8");
    return (
      content.match(
        new RegExp(`${VERSION_MARKER}:\\s*([0-9]+\\.[0-9]+\\.[0-9]+)`),
      )?.[1] ?? null
    );
  } catch {
    return null;
  }
};

const readSkillDirEntries = (skillDir: string): string[] => {
  if (!fs.existsSync(skillDir)) return [];
  if (!fs.lstatSync(skillDir).isDirectory()) {
    throw new Error(`${skillDir} exists and is not a directory`);
  }
  return fs.readdirSync(skillDir);
};

const removeDirIfEmpty = (dir: string): void => {
  if (!fs.existsSync(dir)) return;
  const stat = fs.lstatSync(dir);
  if (stat.isDirectory() && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
  }
};

const buildSkillMarkdown = (): string => `---
name: feishu-remote
description: Send local files back to the current Feishu remote conversation when running through claude-proxy Remote Bridge.
---

<!-- ${VERSION_MARKER}: ${FEISHU_REMOTE_SKILL_VERSION} -->

# Feishu Remote Bridge

Use this skill only when the current task is running in a claude-proxy Feishu remote conversation. The runtime exposes remote context through environment variables such as \`CLAUDE_PROXY_REMOTE_THREAD_ID\`, \`CLAUDE_PROXY_REMOTE_BASE_URL\`, and \`CLAUDE_PROXY_REMOTE_TOKEN\`.

## Send Files To Feishu

When the user asks to send, upload, return, or attach a file to Feishu:

1. Create or update the requested file in the current project directory.
2. Run the helper from the project root:

\`\`\`bash
node .claude/skills/feishu-remote/scripts/send-file.js <file-path> [display-name]
\`\`\`

Rules:

- Use a relative path when possible. The proxy only accepts files inside the current remote project directory.
- Do not paste large file contents into chat unless the user explicitly asks for the contents.
- Never print or expose \`CLAUDE_PROXY_REMOTE_TOKEN\`.
- If the helper reports missing remote context, explain that file upload is available only inside Feishu remote conversations.
- After a successful upload, briefly tell the user which file was sent.
`;

const buildSendFileHelper = (): string => `#!/usr/bin/env node
const fs = require("fs");

const [, , rawPath, displayName] = process.argv;

const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

if (!rawPath) {
  fail("usage: node .claude/skills/feishu-remote/scripts/send-file.js <file-path> [display-name]");
}

if (!fs.existsSync(rawPath)) {
  fail(\`file does not exist: \${rawPath}\`);
}

const threadId = process.env.CLAUDE_PROXY_REMOTE_THREAD_ID || "";
const token = process.env.CLAUDE_PROXY_REMOTE_TOKEN || "";
const port = process.env.CLAUDE_PROXY_REMOTE_PORT || "";
const baseUrl =
  process.env.CLAUDE_PROXY_REMOTE_BASE_URL ||
  (port ? \`http://127.0.0.1:\${port}\` : "");

if (!threadId || !token || !baseUrl) {
  fail("missing claude-proxy Feishu remote context");
}

const url = new URL("/api/remote/feishu/send-file", baseUrl);
const body = JSON.stringify({
  remote_thread_id: threadId,
  path: rawPath,
  name: displayName || undefined,
});

const run = async () => {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Remote-Bridge-Token": token,
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    fail(data.error || \`Feishu upload failed: HTTP \${res.status}\`);
  }
  console.log(
    JSON.stringify({
      ok: true,
      file: data.file,
      fileKey: data.fileKey,
      messageId: data.messageId,
    }),
  );
};

run().catch((err) => fail(err && err.message ? err.message : String(err)));
`;

const helperIsCurrent = (helperPath: string): boolean => {
  try {
    return (
      fs.lstatSync(helperPath).isFile() &&
      fs.readFileSync(helperPath, "utf-8") === buildSendFileHelper()
    );
  } catch {
    return false;
  }
};

export const getFeishuRemoteSkillStatus = (input: {
  cwd?: string | null;
  botId?: string | null;
  botName?: string | null;
}): FeishuRemoteSkillStatus => {
  const cwd = input.cwd?.trim() ? path.resolve(input.cwd) : null;
  if (!cwd) {
    return {
      botId: input.botId,
      botName: input.botName,
      cwd: null,
      installed: false,
      version: null,
      expectedVersion: FEISHU_REMOTE_SKILL_VERSION,
      needsUpdate: false,
      skillPath: null,
      helperPath: null,
      error: "missing default cwd",
    };
  }

  const skillDir = skillDirForCwd(cwd);
  const skillPath = skillPathForCwd(cwd);
  const helperPath = helperPathForCwd(cwd);
  try {
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new Error(`cwd does not exist or is not a directory: ${cwd}`);
    }
    if (!fs.existsSync(skillPath)) {
      if (readSkillDirEntries(skillDir).length > 0) {
        throw new Error(`${skillDir} exists and is not managed by claude-proxy`);
      }
      return {
        botId: input.botId,
        botName: input.botName,
        cwd,
        installed: false,
        version: null,
        expectedVersion: FEISHU_REMOTE_SKILL_VERSION,
        needsUpdate: false,
        skillPath,
        helperPath,
      };
    }
    const version = readVersion(skillPath);
    if (!version) {
      throw new Error(`${skillPath} is not managed by claude-proxy`);
    }
    return {
      botId: input.botId,
      botName: input.botName,
      cwd,
      installed: true,
      version,
      expectedVersion: FEISHU_REMOTE_SKILL_VERSION,
      needsUpdate:
        version !== FEISHU_REMOTE_SKILL_VERSION || !helperIsCurrent(helperPath),
      skillPath,
      helperPath,
    };
  } catch (err) {
    return {
      botId: input.botId,
      botName: input.botName,
      cwd,
      installed: false,
      version: null,
      expectedVersion: FEISHU_REMOTE_SKILL_VERSION,
      needsUpdate: false,
      skillPath,
      helperPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

export const installFeishuRemoteSkill = (input: {
  cwd: string;
  botId?: string | null;
  botName?: string | null;
}): InstallFeishuRemoteSkillResult => {
  const cwd = path.resolve(input.cwd);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`cwd does not exist or is not a directory: ${cwd}`);
  }
  const skillDir = skillDirForCwd(cwd);
  const skillPath = skillPathForCwd(cwd);
  const skillExists = fs.existsSync(skillPath);
  const existingVersion = skillExists ? readVersion(skillPath) : null;
  if (skillExists && existingVersion === null) {
    throw new Error(`${skillPath} is not managed by claude-proxy`);
  }
  if (!skillExists && readSkillDirEntries(skillDir).length > 0) {
    throw new Error(`${skillDir} exists and is not managed by claude-proxy`);
  }

  const scriptsDir = path.join(skillDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });

  fs.writeFileSync(skillPath, buildSkillMarkdown(), "utf-8");
  fs.writeFileSync(helperPathForCwd(cwd), buildSendFileHelper(), "utf-8");
  fs.chmodSync(helperPathForCwd(cwd), 0o755);

  return {
    status: getFeishuRemoteSkillStatus({
      cwd,
      botId: input.botId,
      botName: input.botName,
    }),
  };
};

export const uninstallFeishuRemoteSkill = (input: {
  cwd: string;
  botId?: string | null;
  botName?: string | null;
}): InstallFeishuRemoteSkillResult => {
  const cwd = path.resolve(input.cwd);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`cwd does not exist or is not a directory: ${cwd}`);
  }
  const skillDir = skillDirForCwd(cwd);
  const skillPath = skillPathForCwd(cwd);
  if (!fs.existsSync(skillPath)) {
    if (readSkillDirEntries(skillDir).length > 0) {
      throw new Error(`${skillDir} exists and is not managed by claude-proxy`);
    }
    return {
      status: getFeishuRemoteSkillStatus({
        cwd,
        botId: input.botId,
        botName: input.botName,
      }),
    };
  }
  if (readVersion(skillPath) === null) {
    throw new Error(`${skillPath} is not managed by claude-proxy`);
  }

  const scriptsDir = path.join(skillDir, "scripts");
  fs.rmSync(helperPathForCwd(cwd), { force: true });
  removeDirIfEmpty(scriptsDir);
  fs.rmSync(skillPath, { force: true });
  removeDirIfEmpty(skillDir);
  return {
    status: getFeishuRemoteSkillStatus({
      cwd,
      botId: input.botId,
      botName: input.botName,
    }),
  };
};
