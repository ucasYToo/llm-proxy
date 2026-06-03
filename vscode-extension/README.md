# Claude LLM Proxy - VS Code Extension

配套 [claude-llm-proxy](../README.md) 的 VS Code 插件，通过 proxy 转发调用 LLM API 一键生成 git commit message。

## 安装

```bash
cd vscode-extension
npm install
npm run build
npm install -g @vscode/vsce   # 安装打包工具（一次性）
vsce package                   # 生成 claude-llm-proxy-0.1.0.vsix
```

在 VS Code 中：Extensions → `...` → **Install from VSIX...** → 选择生成的 `.vsix` 文件。

## 使用

1. 确保 `claude-llm-proxy start` 正在运行（默认端口 1998）
2. 在任意 git 项目里修改代码，`git add` stage 变更
3. 打开 Source Control 面板（`⌘+Shift+G`），点标题栏的代理 Hub 图标
4. 等几秒，commit message 自动填入输入框
5. 检查满意后 `⌘+Enter` 提交

> 如果没有 staged 变更，会自动使用 unstaged diff。

## 设置

在 VS Code Settings 中搜索 `claude-proxy`：

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `claude-proxy.proxyPort` | `1998` | proxy 服务端口 |
| `claude-proxy.proxyHost` | `localhost` | proxy 服务地址 |
| `claude-proxy.channelId` | `default` | 使用的转发通道 |
| `claude-proxy.commitMessage.language` | `zh` | 提交信息语言（`zh` / `en`） |
| `claude-proxy.commitMessage.conventionalCommits` | `true` | 使用约定式提交格式 |
| `claude-proxy.commitMessage.maxDiffLines` | `500` | diff 最大行数，超出截断 |
| `claude-proxy.commitMessage.customPrompt` | `""` | 自定义 system prompt |

## 更新

修改源码后：

```bash
npm run build && vsce package
```

在 VS Code 中重新 Install from VSIX 覆盖安装。

## 开发调试

用 VS Code 打开 `vscode-extension/` 目录，按 `F5` 启动 Extension Development Host，在新窗口中打开任意 git 项目即可测试。
