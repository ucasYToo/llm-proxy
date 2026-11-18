import fs from "fs";
import path from "path";
import { claudeConfigDir } from "./local-settings";

export function identifyRawAgent(
  session: string,
  source: string | undefined,
  uuid?: string,
  messageId?: string,
) {
  const fallback = source?.match(/^(?:agent|subagent)[:/](.+)$/i)?.[1];
  if (
    !source ||
    !/(?:agent|subagent)/i.test(source) ||
    !/^[a-zA-Z0-9_-]+$/.test(session)
  )
    return {};
  const projects = path.join(claudeConfigDir, "projects");
  const until = Date.now() + 100;
  try {
    for (const project of fs.readdirSync(projects, { withFileTypes: true })) {
      if (!project.isDirectory() || Date.now() > until) continue;
      const dir = path.join(projects, project.name, session, "subagents");
      if (
        !fs.existsSync(dir) ||
        fs.realpathSync(dir) !==
          path.join(
            fs.realpathSync(projects),
            project.name,
            session,
            "subagents",
          )
      )
        continue;
      for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
        const match = /^agent-([\w-]+)\.jsonl$/.exec(file.name);
        if (!file.isFile() || !match || Date.now() > until) continue;
        const filePath = path.join(dir, file.name);
        if (fs.statSync(filePath).size > 64 * 1024 * 1024) continue;
        for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
          if (
            !(uuid && line.includes(uuid)) &&
            !(messageId && line.includes(messageId))
          )
            continue;
          const item = JSON.parse(line);
          if (
            !(uuid && item.uuid === uuid) &&
            !(messageId && item.message?.id === messageId)
          )
            continue;
          let agentType = fallback;
          const meta = filePath.replace(/\.jsonl$/, ".meta.json");
          if (
            fs.existsSync(meta) &&
            fs.lstatSync(meta).isFile() &&
            fs.statSync(meta).size < 65536
          ) {
            const data = JSON.parse(fs.readFileSync(meta, "utf8"));
            agentType =
              typeof data.agentType === "string" ? data.agentType : fallback;
          }
          return { agentId: match[1], agentType };
        }
      }
    }
  } catch {
    /* Transcript metadata is optional. */
  }
  return { agentType: fallback };
}
