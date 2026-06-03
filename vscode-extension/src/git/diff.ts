import { execSync } from "child_process";

export interface DiffResult {
  diff: string;
  staged: boolean;
  truncated: boolean;
}

export function getGitDiff(cwd: string, maxLines: number): DiffResult {
  let diff = exec("git diff --cached", cwd);
  const staged = diff.trim().length > 0;

  if (!staged) {
    diff = exec("git diff", cwd);
  }

  const lines = diff.split("\n");
  const truncated = lines.length > maxLines;
  if (truncated) {
    diff =
      lines.slice(0, maxLines).join("\n") +
      `\n... (truncated, ${lines.length - maxLines} lines omitted)`;
  }

  return { diff, staged, truncated };
}

function exec(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
}
