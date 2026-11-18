import fs from "fs";
import path from "path";
import { randomBytes, createHash } from "crypto";
import { getDb } from "../../storage/db";
import { claudeConfigDir } from "../../lib/local-settings";
import { readAiTitle } from "../../lib/transcript";
import { assertAllowedCwd } from "../service";
import type { RemoteBridgeFeishuBotConfig } from "../../interfaces/config";

export type ResumeBot = RemoteBridgeFeishuBotConfig & {
  id: string;
  appId: string;
};
export interface Notice {
  id: string;
  bot: string;
  app: string;
  chat: string;
  sender: string;
  session: string;
  cwd: string;
  turn: string;
  status: string;
  threadId: string | null;
  inboundId: string | null;
  prompt: string | null;
}
const real = (dir: string) => {
  try {
    return fs.realpathSync(dir);
  } catch {
    return null;
  }
};
export function matchesRecipient(bot: ResumeBot, sender: string) {
  return (
    bot.handler !== "superagent" &&
    !!bot.localResume?.enabled &&
    bot.localResume.recipientOpenId === sender &&
    (!bot.allowedUserIds?.length || bot.allowedUserIds.includes(sender))
  );
}
export function bindPrivateChat(bot: ResumeBot, sender: string, chat: string) {
  if (!matchesRecipient(bot, sender)) return;
  getDb()
    .prepare("INSERT OR REPLACE INTO feishu_private_chats VALUES (?,?,?,?)")
    .run(bot.id, bot.appId, sender, chat);
}
export function boundChat(bot: ResumeBot) {
  return (
    getDb()
      .prepare(
        "SELECT chat FROM feishu_private_chats WHERE bot=? AND app=? AND sender=?",
      )
      .get(bot.id, bot.appId, bot.localResume?.recipientOpenId ?? "") as
      | { chat: string }
      | undefined
  )?.chat;
}
export function botForCwd(bots: ResumeBot[], cwd: string) {
  const active = bots.filter(
    (b) => b.handler !== "superagent" && b.localResume?.enabled,
  );
  const matches = active.filter((b) =>
    (b.localResume?.projects ?? []).some((p) => real(p) === cwd),
  );
  const selected = matches.length
    ? matches
    : active.filter((b) => b.localResume?.defaultBot);
  if (selected.length) return selected.length === 1 ? selected[0] : undefined;
  // Older single-bot bindings may have neither a project list nor a default flag.
  const only = active.length === 1 ? active[0] : undefined;
  if (
    only &&
    only.localResume?.defaultBot === undefined &&
    !only.localResume?.projects?.length
  )
    return only;
  return undefined;
}
function newNotice(
  bot: ResumeBot,
  chat: string,
  session: string,
  cwd: string,
  turn: string,
) {
  const db = getDb(),
    sender = bot.localResume!.recipientOpenId;
  const existing = db
    .prepare(
      "SELECT * FROM feishu_resume_notices WHERE bot=? AND app=? AND chat=? AND sender=? AND session=? AND turn=?",
    )
    .get(bot.id, bot.appId, chat, sender, session, turn) as Notice | undefined;
  if (existing) return existing;
  const id = randomBytes(8).toString("hex");
  db.prepare(
    "INSERT INTO feishu_resume_notices(id,bot,app,chat,sender,session,cwd,turn,status,created) VALUES (?,?,?,?,?,?,?,?,'sending',?)",
  ).run(id, bot.id, bot.appId, chat, sender, session, cwd, turn, Date.now());
  return db
    .prepare("SELECT * FROM feishu_resume_notices WHERE id=?")
    .get(id) as Notice;
}
export function activateNotice(notice: Notice, refs: string[]) {
  const db = getDb();
  db.transaction(() => {
    const ref = db.prepare(
      "INSERT OR IGNORE INTO feishu_resume_refs VALUES (?,?,?)",
    );
    for (const id of refs) ref.run(notice.bot, id, notice.id);
    db.prepare(
      "UPDATE feishu_resume_notices SET status='pending',card=NULL WHERE id=? AND status='sending'",
    ).run(notice.id);
    db.prepare(
      "UPDATE feishu_resume_notices SET status='superseded' WHERE session=? AND status='pending' AND rowid < (SELECT MAX(rowid) FROM feishu_resume_notices WHERE session=? AND status IN ('pending','consumed','running','queued'))",
    ).run(notice.session, notice.session);
  })();
}
type Deliver = (notice: Notice, text: string) => Promise<string | null>;
const sending = new Set<string>();
async function deliverNotice(n: Notice, text: string, deliver: Deliver) {
  if (sending.has(n.id)) return;
  sending.add(n.id);
  try {
    getDb()
      .prepare("UPDATE feishu_resume_notices SET retryAt=? WHERE id=?")
      .run(Date.now() + 60000, n.id);
    const ref = await deliver(n, text);
    if (ref) activateNotice(n, [ref]);
  } finally {
    sending.delete(n.id);
  }
}
export async function retryNotices(bots: ResumeBot[], deliver: Deliver) {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM feishu_resume_notices WHERE status='sending' AND card IS NOT NULL AND retryAt<=? ORDER BY created LIMIT 20",
    )
    .all(Date.now()) as (Notice & { card: string; created: number })[];
  for (const n of rows) {
    const bot = botForCwd(bots, n.cwd);
    if (
      !bot ||
      !authorizedNotice(n, bot, n.sender, n.chat) ||
      Date.now() - n.created > 3600000
    ) {
      db.prepare(
        "UPDATE feishu_resume_notices SET status='expired',card=NULL WHERE id=?",
      ).run(n.id);
      continue;
    }
    try {
      assertAllowedCwd(n.cwd);
      const stored = JSON.parse(n.card);
      // Older pending sends stored a card. Replay only its visible title and body.
      const text =
        typeof stored === "string"
          ? stored
          : [stored.header.title.content, stored.elements[0].text.content].join(
              "\n\n",
            );
      await deliverNotice(n, text, deliver);
    } catch {
      /* Retry after the next deadline. */
    }
  }
}
export async function localStop(
  bots: ResumeBot[],
  payload: Record<string, any>,
  deliver: Deliver,
) {
  if (
    !bots.some((b) => b.localResume?.enabled) ||
    payload.agent_id ||
    !["Stop", "StopFailure"].includes(payload.hook_event_name)
  )
    return;
  const session = payload.session_id;
  if (
    typeof session !== "string" ||
    !/^[a-zA-Z0-9_-]{1,160}$/.test(session) ||
    typeof payload.cwd !== "string"
  )
    return;
  const cwd = real(payload.cwd);
  if (!cwd) return;
  const bot = botForCwd(bots, cwd);
  if (!bot || !matchesRecipient(bot, bot.localResume!.recipientOpenId)) return;
  const chat = boundChat(bot);
  if (!chat) return;
  assertAllowedCwd(cwd);
  const transcript =
    typeof payload.transcript_path === "string"
      ? real(payload.transcript_path)
      : null;
  const projects = real(path.join(claudeConfigDir, "projects"));
  if (
    !projects ||
    !transcript?.startsWith(projects + path.sep) ||
    path.dirname(path.dirname(transcript)) !== projects ||
    path.basename(transcript) !== session + ".jsonl"
  )
    return;
  const stat = fs.statSync(transcript);
  if (!stat.isFile()) return;
  const body =
    payload.hook_event_name === "StopFailure"
      ? "本轮执行失败"
      : typeof payload.last_assistant_message === "string"
        ? payload.last_assistant_message.trim().slice(0, 1800)
        : "";
  const turn =
    typeof payload.turn_id === "string"
      ? payload.turn_id
      : createHash("sha256")
          .update(JSON.stringify([stat.size, body]))
          .digest("hex");
  const n = newNotice(bot, chat, session, cwd, turn);
  if (n.status !== "sending") return;
  const title = readAiTitle(transcript) || path.basename(cwd);
  const text = [
    "Claude · " + title.slice(0, 80),
    body,
    "要继续这个会话，在这条消息上点「回复」并输入下一步指令。",
  ]
    .filter(Boolean)
    .join("\n\n");
  getDb()
    .prepare(
      "UPDATE feishu_resume_notices SET card=? WHERE id=? AND status='sending'",
    )
    .run(JSON.stringify(text), n.id);
  await deliverNotice(n, text, deliver);
}
export function lookupNotice(bot: string, parent: unknown, text: string) {
  const code = /^#续接-([a-f0-9]+)(?:\s+|$)/i.exec(text);
  const db = getDb();
  const byRef =
    typeof parent === "string" &&
    db
      .prepare(
        "SELECT n.* FROM feishu_resume_notices n JOIN feishu_resume_refs r ON r.notice=n.id WHERE r.bot=? AND r.message=?",
      )
      .get(bot, parent);
  const notice = (byRef ||
    (code &&
      db
        .prepare("SELECT * FROM feishu_resume_notices WHERE id=?")
        .get(code[1]))) as Notice | undefined;
  return {
    recognized:
      !!notice ||
      text.startsWith("#续接-") ||
      (typeof parent === "string" &&
        !!db
          .prepare("SELECT 1 FROM feishu_resume_refs WHERE message=?")
          .get(parent)),
    notice,
    prompt: code ? text.slice(code[0].length).trim() : text,
  };
}
export function authorizedNotice(
  n: Notice,
  bot: ResumeBot,
  sender: string,
  chat: string,
) {
  return (
    n.bot === bot.id &&
    n.app === bot.appId &&
    n.sender === sender &&
    n.chat === chat &&
    matchesRecipient(bot, sender) &&
    boundChat(bot) === chat
  );
}
export function claimNotice(n: Notice, inboundId: string, prompt: string) {
  const db = getDb();
  return db
    .transaction(() => {
      if (
        db
          .prepare(
            "SELECT 1 FROM feishu_resume_notices WHERE bot=? AND inboundId=?",
          )
          .get(n.bot, inboundId)
      )
        return "duplicate";
      if (n.status !== "pending") return "expired";
      if (
        db
          .prepare(
            "SELECT 1 FROM feishu_resume_notices WHERE session=? AND status IN ('queued','running')",
          )
          .get(n.session)
      )
        return "busy";
      if (
        db
          .prepare(
            "SELECT 1 FROM remote_threads WHERE claudeSessionId=? AND status IN ('running','queued','waiting_permission')",
          )
          .get(n.session)
      )
        return "busy";
      try {
        assertAllowedCwd(n.cwd);
      } catch {
        return "expired";
      }
      return db
        .prepare(
          "UPDATE feishu_resume_notices SET status='queued',inboundId=?,prompt=? WHERE id=? AND status='pending'",
        )
        .run(inboundId, prompt, n.id).changes === 1
        ? "queued"
        : "expired";
    })
    .immediate();
}
export function runningNotice(
  threadId: string,
  sourceMessageId?: string | null,
) {
  return getDb()
    .prepare(
      "SELECT * FROM feishu_resume_notices WHERE threadId=? AND status='running' AND (? IS NULL OR inboundId=?)",
    )
    .get(threadId, sourceMessageId ?? null, sourceMessageId ?? null) as
    | Notice
    | undefined;
}
export function finalNotice(
  origin: Notice,
  turn: string,
  refs: string[],
  bot: ResumeBot,
) {
  const db = getDb();
  db.transaction(() => {
    const claimed = db
      .prepare(
        "UPDATE feishu_resume_notices SET status='consumed',prompt=NULL WHERE id=? AND status='running'",
      )
      .run(origin.id);
    if (
      !claimed.changes ||
      !refs.length ||
      !authorizedNotice(origin, bot, origin.sender, origin.chat)
    )
      return;
    activateNotice(
      newNotice(bot, origin.chat, origin.session, origin.cwd, turn),
      refs,
    );
  })();
}
