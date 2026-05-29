import fs from "fs";
import path from "path";
import { getDb } from "../storage/db";

const CLAUDE_SESSIONS_DIR = path.join(
  process.env.HOME || "~",
  ".claude",
  "sessions",
);

const MAX_CACHE_SIZE = 1000;
const cwdCache = new Map<string, string>();

export const normalizeCwd = (cwd: string): string =>
  cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;

const persistSessionCwd = (sessionId: string, cwd: string): void => {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO session_cwds (sessionId, cwd, createdAt) VALUES (?, ?, ?)`,
  ).run(sessionId, cwd, new Date().toISOString());
};

const lookupFromDb = (sessionId: string): string | null => {
  const db = getDb();
  const row = db
    .prepare(`SELECT cwd FROM session_cwds WHERE sessionId = ?`)
    .get(sessionId) as { cwd: string } | undefined;
  return row?.cwd ?? null;
};

const lookupFromFiles = (sessionId: string): string | null => {
  try {
    if (!fs.existsSync(CLAUDE_SESSIONS_DIR)) return null;
    const files = fs.readdirSync(CLAUDE_SESSIONS_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = fs.readFileSync(
          path.join(CLAUDE_SESSIONS_DIR, file),
          "utf-8",
        );
        const data = JSON.parse(content);
        if (data.sessionId === sessionId && data.cwd) {
          return normalizeCwd(data.cwd);
        }
      } catch {
        // skip malformed files
      }
    }
  } catch {
    // sessions dir not accessible
  }
  return null;
};

export const resolveSessionCwd = (sessionId: string): string | null => {
  const cached = cwdCache.get(sessionId);
  if (cached) return cached;

  const fromDb = lookupFromDb(sessionId);
  if (fromDb) {
    cwdCache.set(sessionId, fromDb);
    return fromDb;
  }

  const fromFile = lookupFromFiles(sessionId);
  if (fromFile) {
    if (cwdCache.size >= MAX_CACHE_SIZE) {
      const oldest = cwdCache.keys().next().value!;
      cwdCache.delete(oldest);
    }
    cwdCache.set(sessionId, fromFile);
    persistSessionCwd(sessionId, fromFile);
    return fromFile;
  }

  return null;
};

export interface KnownProject {
  cwd: string;
  remark: string | null;
  lastSeen: string;
}

export const getKnownProjects = (): KnownProject[] => {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.cwd, p.remark, MAX(s.createdAt) as lastSeen
       FROM session_cwds s
       LEFT JOIN projects p ON s.cwd = p.cwd
       GROUP BY s.cwd
       ORDER BY lastSeen DESC`,
    )
    .all() as KnownProject[];
};

export const updateProjectRemark = (cwd: string, remark: string): void => {
  const db = getDb();
  db.prepare(
    `INSERT INTO projects (cwd, remark) VALUES (?, ?) ON CONFLICT(cwd) DO UPDATE SET remark = excluded.remark`,
  ).run(cwd, remark);
};
