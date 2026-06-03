export function buildCommitPrompt(options: {
  diff: string;
  language: "zh" | "en";
  conventionalCommits: boolean;
  customPrompt?: string;
}): { system: string; user: string } {
  const { diff, language, conventionalCommits, customPrompt } = options;

  const system = customPrompt?.trim() || getDefaultSystemPrompt(language, conventionalCommits);
  const user = `Generate a commit message for the following git diff:\n\n${diff}`;

  return { system, user };
}

function getDefaultSystemPrompt(
  language: "zh" | "en",
  conventionalCommits: boolean,
): string {
  if (language === "zh") {
    return conventionalCommits ? SYSTEM_ZH_CONVENTIONAL : SYSTEM_ZH_PLAIN;
  }
  return conventionalCommits ? SYSTEM_EN_CONVENTIONAL : SYSTEM_EN_PLAIN;
}

const SYSTEM_ZH_CONVENTIONAL = `你是一个 git commit message 生成器。分析提供的 git diff，生成简洁、准确的提交信息。

规则：
1. 使用 Conventional Commits 格式：<type>(<scope>): <描述>
2. 类型：feat, fix, refactor, docs, style, test, chore, perf, ci, build
3. scope 可选，填写受影响的模块/组件名
4. 描述用中文，简明扼要，不加句号
5. 第一行不超过 72 个字符
6. 如果改动较复杂，空一行后补充说明"为什么"做这个改动
7. 只输出 commit message，不要解释、不要 markdown 格式`;

const SYSTEM_ZH_PLAIN = `你是一个 git commit message 生成器。分析提供的 git diff，生成简洁、准确的提交信息。

规则：
1. 描述用中文，简明扼要，不加句号
2. 第一行不超过 72 个字符
3. 如果改动较复杂，空一行后补充说明
4. 只输出 commit message，不要解释、不要 markdown 格式`;

const SYSTEM_EN_CONVENTIONAL = `You are a git commit message generator. Analyze the provided git diff and generate a concise, informative commit message.

Rules:
1. Use Conventional Commits format: <type>(<scope>): <description>
2. Types: feat, fix, refactor, docs, style, test, chore, perf, ci, build
3. The scope is optional and should be the module/component affected
4. The description should be in imperative mood, lowercase, no period at the end
5. Keep the first line under 72 characters
6. If the change is complex, add a blank line followed by a body explaining the "why"
7. Output ONLY the commit message, no explanation or markdown formatting`;

const SYSTEM_EN_PLAIN = `You are a git commit message generator. Analyze the provided git diff and generate a concise, informative commit message.

Rules:
1. Use imperative mood, lowercase, no period at the end
2. Keep the first line under 72 characters
3. If the change is complex, add a blank line followed by a body
4. Output ONLY the commit message, no explanation or markdown formatting`;
