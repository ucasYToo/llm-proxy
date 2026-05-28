import fs from "fs";

/**
 * Read the most recent `ai-title` event from a Claude Code transcript JSONL file.
 *
 * Claude Code periodically writes lines like:
 *   {"type":"ai-title","aiTitle":"Explain ...","sessionId":"..."}
 *
 * Only the file tail is read (default 64KB) to avoid loading huge transcripts;
 * results are memoized by mtimeMs so repeated calls are cheap.
 */

const TAIL_BYTES = 64 * 1024;

interface CacheEntry {
  title: string | null;
  mtimeMs: number;
}

const cache = new Map<string, CacheEntry>();

export const readAiTitle = (transcriptPath: string | undefined | null): string | null => {
  if (!transcriptPath) return null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(transcriptPath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const cached = cache.get(transcriptPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.title;

  const start = Math.max(0, stat.size - TAIL_BYTES);
  const length = stat.size - start;
  const buf = Buffer.alloc(length);

  let fd: number | null = null;
  try {
    fd = fs.openSync(transcriptPath, "r");
    fs.readSync(fd, buf, 0, length, start);
  } catch {
    cache.set(transcriptPath, { title: null, mtimeMs: stat.mtimeMs });
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }

  const text = buf.toString("utf8");
  const lines = text.split("\n");

  let title: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"type":"ai-title"')) continue;
    try {
      const obj = JSON.parse(line) as { type?: string; aiTitle?: unknown };
      if (obj.type === "ai-title" && typeof obj.aiTitle === "string" && obj.aiTitle.trim()) {
        title = obj.aiTitle.trim();
        break;
      }
    } catch {
      // line[0] may be a partial JSON object when we read mid-line; skip
    }
  }

  cache.set(transcriptPath, { title, mtimeMs: stat.mtimeMs });
  return title;
};
