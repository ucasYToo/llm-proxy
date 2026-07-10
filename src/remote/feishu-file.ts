import fs from "fs";
import path from "path";

import type { RemoteThread } from "../storage/remote";

export const FEISHU_REMOTE_FILE_MAX_BYTES = 30 * 1024 * 1024;

export interface ResolvedRemoteFeishuFile {
  filePath: string;
  displayName: string;
  sizeBytes: number;
}

const isInsideDir = (dir: string, file: string): boolean => {
  const relative = path.relative(dir, file);
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const sanitizeDisplayName = (raw: string | null | undefined): string | null => {
  const value = raw?.trim();
  if (!value) return null;
  return path.basename(value).slice(0, 240);
};

export const resolveRemoteFeishuFile = (input: {
  thread: Pick<RemoteThread, "cwd">;
  filePath: string;
  displayName?: string | null;
  maxBytes?: number;
}): ResolvedRemoteFeishuFile => {
  const cwd = input.thread.cwd?.trim();
  if (!cwd) throw new Error("remote thread has no cwd");
  if (!input.filePath?.trim()) throw new Error("file path is required");

  const cwdReal = fs.realpathSync.native(cwd);
  const requested = path.isAbsolute(input.filePath)
    ? input.filePath
    : path.resolve(cwdReal, input.filePath);

  if (!fs.existsSync(requested)) {
    throw new Error(`file does not exist: ${input.filePath}`);
  }

  const fileReal = fs.realpathSync.native(requested);
  if (!isInsideDir(cwdReal, fileReal)) {
    throw new Error("file must be inside the remote thread project directory");
  }

  const stat = fs.statSync(fileReal);
  if (!stat.isFile()) throw new Error("file path must point to a regular file");
  if (stat.size <= 0) throw new Error("empty files cannot be sent to Feishu");

  const maxBytes = input.maxBytes ?? FEISHU_REMOTE_FILE_MAX_BYTES;
  if (stat.size > maxBytes) {
    throw new Error(
      `file is too large for Feishu upload (${stat.size} bytes > ${maxBytes} bytes)`,
    );
  }

  return {
    filePath: fileReal,
    displayName: sanitizeDisplayName(input.displayName) ?? path.basename(fileReal),
    sizeBytes: stat.size,
  };
};
