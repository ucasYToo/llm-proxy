import { exec } from "child_process";

const escape = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export const notify = (title: string, message: string, sound?: string): void => {
  if (process.platform !== "darwin") return;

  const parts: string[] = [
    `display notification "${escape(message)}"`,
    `with title "${escape(title)}"`,
  ];
  if (sound) {
    parts.push(`sound name "${escape(sound)}"`);
  }
  const cmd = `osascript -e '${parts.join(" ")}'`;

  exec(cmd, (err) => {
    if (err) {
      // Swallow notification errors — they shouldn't break hook handling.
    }
  });
};
