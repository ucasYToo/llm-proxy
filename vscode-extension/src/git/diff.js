"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGitDiff = getGitDiff;
const child_process_1 = require("child_process");
function getGitDiff(cwd, maxLines) {
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
function exec(cmd, cwd) {
    return (0, child_process_1.execSync)(cmd, { cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
}
