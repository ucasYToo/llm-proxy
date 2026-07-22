# claude-proxy

一个面向 Claude Code、并兼容 Codex 日志采集的本地代理、Dashboard 和远程控制工具。

它主要解决中文互联网环境里的几个实际问题：多上游模型代理、Claude Code hook 可视化、费用统计、飞书通知，以及从 Web/飞书远程继续或新建本机 Claude Code 对话。

当前版本：**2.4.0**

## 适合谁

- 你在本机使用 Claude Code，但希望通过不同模型服务或中转服务访问模型。
- 你想看清 Claude Code 每次请求、工具调用、hook 事件、会话耗时和费用。
- 你希望在飞书里像聊天一样远程丢任务给本机 Claude Code，并在飞书里看到进度和最终回复。
- 你需要在公司网络、家里机器、Tailscale、内网穿透等场景下远程控制自己的开发环境。

如果你只是正常使用官方 Claude Code，并且不需要飞书、代理、费用统计或远程桥接，这个工具可能不是必需品。

## 主要功能

- **Claude Code 代理**：把 Claude Code API 请求转发到你配置的上游服务。
- **多通道路由**：不同项目目录可以路由到不同目标模型或不同代理通道。
- **Dashboard**：查看请求日志、SSE 流、hook 事件、会话、项目和费用统计。
- **Codex Dashboard**：使用与主 Dashboard 一致的项目卡片、Session 导航、实时事件筛选和详情面板，查看 Codex 用户消息、助手最终回复、工具 hooks，以及手动开启的本地 Rollout Trace 原文；保留 Codex 主题色和独立 SQLite，不接入远程对话。
- **Hook 管理**：一键写入 Claude Code hooks，捕获 SessionStart、工具调用、Stop 等事件。
- **配置备份**：从 Dashboard 或 CLI 导出脱敏配置，并安全回导目标、通道、通知和 Remote Bridge 设置。
- **Web/飞书远程对话**：从 Dashboard 或飞书继续已有 Claude Code 会话，或按项目新建远程任务。
- **飞书进度卡片**：每条飞书消息对应一张紧凑进度卡片，执行中更新卡片，最终答案用普通聊天文本发回。
- **通知**：支持 macOS、钉钉、飞书自定义机器人通知指定 hook 事件。
- **macOS 状态栏**：显示当前活动和当天费用，支持防休眠。
- **SQLite 存储**：日志、费用、hook、远程线程和进度卡片都落在本地数据库。

## 安装

```bash
npm install -g llm-proxy-view
```

本地开发：

```bash
npm install
npm run build
node bin/cli.js --help
```

## 快速开始

```bash
# 启动服务和 Dashboard，默认 http://localhost:1998
claude-proxy start --ui

# 安装 Claude Code hooks，让会话和工具调用进入 Dashboard
claude-proxy hook install --port 1998

# 打开 Dashboard，添加上游目标，然后点击“接入代理”
```

常用命令：

```bash
claude-proxy start --port 1998 --host localhost --ui
claude-proxy config list
claude-proxy logs --limit 20
claude-proxy hook status
claude-proxy channel status
```

启动日志默认保持精简，只显示关键地址和异常请求；排查时可用 `claude-proxy start --ui --verbose` 查看端点列表和每请求访问日志。

## Dashboard

启动时带上 `--ui` 后，Dashboard 会由同一个代理进程提供。

- **配置**：管理上游目标、认证 header、模型映射、通道和项目目录路由。
- **日志**：查看代理请求、响应耗时、token、费用和原始 SSE 输出。
- **Dashboard**：按项目查看 Claude Code 会话、hook 事件和远程对话入口；Hooks 未完整安装或端口已变化时可直接一键修复。
- **Codex**：按项目和 Session 查看 Codex 用户消息、助手最终回复、工具事件与可选 Rollout Trace；交互与主 Dashboard 对齐，数据物理写入独立数据库。
- **分析**：查看费用趋势、模型分布、会话排行和健康状态。
- **状态栏**：配置 macOS 状态栏助手和防休眠行为。

## Codex Dashboard

Codex 接入只覆盖本地对话日志；Web/飞书远程会话暂不接入 Codex。Codex Tab 沿用主 Dashboard 的项目总览、Session 侧栏、事件筛选和详情抽屉，并使用独立的 Codex 主题色。它通过 Codex command hooks 采集用户消息、助手最终回复、工具调用和生命周期事件；需要排查模型原文时，可以手动开启 Codex 本地 Rollout Trace。两种方式都不代理模型请求，也不修改 ChatGPT 登录状态或 API 地址。

Codex Tab 支持独立配置钉钉和飞书自定义机器人 webhook，不会读取或修改 Claude Dashboard 的通知开关与凭证。`Stop`、`SubagentStop` 分别推送任务和子代理完成；配置面板里的 `PermissionRequest` 用于推送 Codex 授权等待事件。

Codex 数据不会写入 Claude 的 `logs.db`，而是单独保存在：

```text
~/.claude-proxy/codex-logs.db
```

先启动服务并安装 Codex command hooks：

```bash
claude-proxy start --ui --port 1998
claude-proxy codex hook install --port 1998
```

安装或更新 hooks 后，需要在 Codex CLI 中运行 `/hooks` 检查并信任配置。Codex 桌面 App 当前不提供 `/hooks` 命令；桌面用户可以打开终端，运行 `codex` 进入 CLI，完成一次 `/hooks` 信任后再回到 App，新建任务或重启 App。之后继续按原方式登录和使用 Codex 即可；日志转发是 fail-open 的，Dashboard 未运行时不会阻塞 Codex。

模型请求原文默认关闭，可在 Codex Tab 点击“开启原文日志”，也可使用：

```bash
claude-proxy codex trace start
claude-proxy codex trace status
claude-proxy codex trace stop
```

开关通过 `CODEX_ROLLOUT_TRACE_ROOT` 控制，所以开启或关闭后都要完全退出并重开 Codex 才会作用到该 Codex 进程。Dashboard 的“结束采集”会立即撤销环境开关；由 Dashboard 开启的采集也会在服务正常退出时自动撤销。Codex 当前没有 SessionEnd hook，不能用一轮回复结束的 `Stop` 事件冒充会话关闭。

原始 bundle 保存在 `~/.claude-proxy/codex-rollout-traces/`，包含请求、响应、工具输入输出和 reasoning。总量上限为 1 GB，Dashboard 每 20 秒检查一次，超限时从最旧的 bundle 开始删除。`codex-logs.db` 只保存 bundle 路径与会话索引，点击事件详情时才读取 Codex 原文件，不复制原文正文。

常用诊断命令：

```bash
claude-proxy codex status
claude-proxy codex hook status
claude-proxy codex hook uninstall
```

## 远程对话

远程对话的目标是：Web 或飞书里发一条消息，本机 Claude Code 在指定项目目录执行，并把过程和最终回复送回来。

链路图可以直接打开：[docs/remote-bridge-flow.html](docs/remote-bridge-flow.html)

### 当前执行链路

2.2.0 默认使用 CLI fallback：

```text
Web / 飞书
  -> llm-proxy /api/remote/send
  -> remote_threads + remote_messages 入库
  -> claude -p --output-format stream-json --verbose --include-partial-messages --include-hook-events
  -> 聚合进度快照
  -> Dashboard SSE + 飞书进度卡片
  -> 最终答案作为普通聊天文本回到飞书/Web
```

`remoteBridge.deliveryMode` 支持三种模式：

- `cli`：默认模式，使用 `claude -p`，当前最稳定。
- `channel`：使用 Claude Code MCP channel 实验能力，需要 Claude Code 本身支持 channels。
- `auto`：优先使用在线 channel instance，没有可用 channel 时回退到 `cli`。

为什么现在默认不是 channel：Claude Code channels 仍是实验能力，而且部分版本会提示 `Channels are not currently available`。为了保证飞书/Web 远程对话先稳定可用，当前发布版把 `claude -p` 作为主路径，channel 代码保留为后续增强路径。

CLI fallback 对每条入站消息只生成一份最终文本回复：如果 Claude 已显式调用 `remote_reply`，该回复会优先，代理不会再转发 CLI 的同轮最终文本。用户请求的文件上传仍会作为独立飞书文件消息发送。

### Dashboard 使用方式

1. 启动 `claude-proxy start --ui`。
2. 打开 Dashboard，进入远程/飞书配置区域。
3. 启用 Remote Bridge。
4. 在项目卡或 session list 中新建远程对话，或继续已有会话；Dashboard 会直接使用当前项目/session 的 cwd。

### 飞书远程 Skill

飞书远程配置面板会按每个机器人自己的 `defaultCwd` 显示 `feishu-remote` skill 状态，并支持安装、更新和移除。这个 skill 安装在项目目录的 `.claude/skills/feishu-remote/` 下，用来让远程 Claude 在用户要求“把文件发回飞书”时调用本机受保护接口上传文件。

- 安装入口在 Dashboard，不需要用户手动运行 CLI。
- 每个飞书机器人建议绑定独立 `defaultCwd`，skill 也安装在该机器人对应的项目目录。
- 文件回传只允许发送当前远程 thread 项目目录内的普通文件，单文件不超过飞书上传限制 30MB。
- skill 只读取运行时注入的远程上下文和 token；`remoteBridge.authToken` 不会通过普通配置接口返回给浏览器。

### 飞书接入方式

飞书输入使用 **飞书自建应用长连接**，不是旧的飞书自定义机器人 webhook。自定义机器人只能做通知输出，不能作为稳定的消息输入入口。

飞书应用需要具备：

- 接收 `im.message.receive_v1` 事件
- 发送普通文本消息
- 发送交互卡片
- 更新已经发送的交互卡片
- 上传并发送文件消息（如果需要远程 Claude 回传文件）

推荐配置步骤：

1. 在飞书开放平台创建自建应用。
2. 启用机器人能力，打开消息事件订阅。
3. 在 Dashboard 的远程配置表单中添加一个或多个飞书机器人，填入各自的默认项目路径、`appId`、`appSecret`，以及可选的 `encryptKey`、`verificationToken`。
4. 把机器人加入私聊或群聊。
5. 私聊默认继续最近 active thread；群聊里需要 @bot 或回复 bot 消息。

飞书支持的命令：

```text
/help
/status
/status <threadId>
/projects
/threads
/threads <status>
/sessions
/sessions <项目>
/new <项目别名或路径> <prompt>
/continue <threadId> <prompt>
/use <threadId>
/show <threadId>
/stop [threadId]
/use-session <sessionId>
/continue-session <sessionId> <prompt>
同意 <permissionId>
拒绝 <permissionId>
```

命令语义：

- `/status` 除了 Bridge 和当前 thread 状态，还会返回当前用户飞书 ID、完整/短远程对话 ID、当前群或私聊 Chat ID，以及当前消息链 ID，便于排查远程上下文。
- `/projects` 列出 Dashboard 已发现的项目和补充配置目录，项目备注也可以作为 `/new` 的别名。
- `/threads` 查看当前飞书聊天可见的远程对话 thread；它不会泄露其他聊天、其他用户或 Web 创建的 thread。
- `/sessions` 查看本机最近 Claude Code 会话；`/use-session` 会把当前飞书聊天绑定到本地 session，之后普通消息会通过 `claude -p --resume <sessionId>` 继续它。
- `/continue-session` 是一步到位的本地会话继续命令；`sessionId` 支持唯一前缀。
- 普通消息会继续当前飞书聊天最近使用或 `/use`、`/use-session` 绑定的远程对话。

飞书展示规则：

- 每条入站飞书消息创建一张进度卡片。
- 执行中合并并节流更新同一张卡片，避免刷屏和触发飞书频控。
- 卡片展示状态、项目、耗时、最近过程、工具摘要和错误。
- 最终 Claude 回复用普通聊天文本发送，不再塞进卡片里，也不使用飞书话题回复。

### 可选 MCP Channel

当 Claude Code channels 可用时，可以安装项目级 MCP 配置：

```bash
cd /path/to/project
claude-proxy channel install --scope project --port 1998
claude-proxy channel status
```

注册的 MCP server 名称是 `claude-proxy-remote`，对应 binary 是 `claude-proxy-channel`。

如果你的 Claude Code 版本支持 development channels，可以这样启动：

```bash
claude --dangerously-load-development-channels server:claude-proxy-remote
```

如果 Claude Code 提示 channels 不可用，继续使用默认 `cli` 模式即可。

## 配置文件

持久配置位于：

```text
~/.claude-proxy/config.json
~/.claude-proxy/logs.db
~/.claude-proxy/codex-logs.db
```

常见 `remoteBridge` 配置：

```json
{
  "remoteBridge": {
    "enabled": true,
    "authToken": "local-shared-token",
    "web": {
      "enabled": true,
      "publicBaseUrl": "https://your-dashboard.example"
    },
    "allowedCwds": ["/Users/me/workspace/project"],
    "claudeCommand": "claude",
    "permissionMode": "default",
    "deliveryMode": "cli",
    "feishu": {
      "enabled": true,
      "ingress": "longConnection",
      "bots": [
        {
          "id": "default",
          "name": "默认机器人",
          "enabled": true,
          "defaultCwd": "/Users/me/workspace/project",
          "appId": "...",
          "appSecret": "...",
          "encryptKey": "...",
          "verificationToken": "...",
          "allowedUserIds": []
        }
      ],
      "progressCard": {
        "enabled": true,
        "showToolEvents": true
      }
    }
  }
}
```

安全建议：

- 不要把 Dashboard 裸露到公网；需要远程访问时使用带鉴权的反向代理、Tailscale 或隧道。
- `remoteBridge.authToken` 用于 channel/internal remote API，不会通过普通配置接口暴露给浏览器。
- Remote Bridge 可启动 Dashboard 已发现项目，以及 `allowedCwds` 和各 `feishu.bots[].defaultCwd` 中补充的目录；不要把 Dashboard 裸露给不可信用户。
- 每个 `feishu.bots[]` 建议绑定自己的 `defaultCwd`，实现“一个飞书机器人对应一个项目目录”。
- 群聊场景建议给每个 `feishu.bots[]` 配置 `allowedUserIds`，避免任意群成员触发本机 Claude Code。

## Hook 管理

```bash
claude-proxy hook install --port 1998
claude-proxy hook status
claude-proxy hook uninstall
```

当前管理的 hook 事件：

```text
SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / PostToolUseFailure /
StopFailure / PermissionDenied / Notification / SubagentStart / SubagentStop /
Stop / SessionEnd
```

Dashboard 会检查全部受管事件是否指向当前服务端口；未安装、安装不完整或端口变化时，可以直接点击“安装 Hooks”。

## 配置备份与恢复

配置页右上角可以直接导出或导入 JSON，也可以使用 CLI：

```bash
claude-proxy config export --output ./llm-proxy-config.json
claude-proxy config import --file ./llm-proxy-config.json
```

导出文件不会包含目标认证值、敏感 Header、通知 webhook 凭证、Remote Bridge token 或飞书机器人密钥。回导到同一台机器时，只会在 target ID 与 URL、bot ID 与 appId 都一致时保留本机已有凭证；复制到其他机器后，需要重新填写这些凭证。导入会拒绝字段类型错误、重复 ID 或引用不存在 target/channel 的配置。

从 Dashboard 导入会立即重启飞书 Remote Bridge；服务运行期间若改用 CLI 导入，请重启 `claude-proxy` 以应用飞书长连接配置。

## 上游目标和通道路由

```bash
claude-proxy config list
claude-proxy config add --name "OpenAI" \
  --url "https://api.openai.com/v1" \
  --headers '{"Authorization":"Bearer sk-xxx"}' \
  --anthropic-model "claude-opus-4-7"
claude-proxy config set-active --name "OpenAI"
claude-proxy config delete --name "OpenAI"

claude-proxy config channel list
claude-proxy config channel add --name "default"
claude-proxy config channel set-active --channel <channelId> --target <targetName>
claude-proxy config channel add-cwd-route --channel <channelId> --cwd <path> --target <targetName>
claude-proxy config channel remove-cwd-route --channel <channelId> --cwd <path>
```

## API 概览

常用 Dashboard/API：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/api/query?type=config` | 当前配置 |
| GET | `/api/query?type=logs` | 代理请求日志 |
| GET | `/api/query?type=hooks` | Claude Code hook 事件 |
| GET | `/api/query?type=hook-status` | Claude Code Hooks 完整状态 |
| GET | `/api/query?type=sessions` | 最近会话 |
| GET | `/api/query?type=remote-threads` | 远程对话 thread |
| GET | `/api/query?type=remote-messages` | 远程消息 |
| GET | `/api/query?type=remote-instances` | 远程 channel instance |
| GET | `/api/events` | Dashboard SSE |
| POST | `/api/hooks/:event` | Claude Code hook 回调 |
| POST | `/api/set` | 修改配置 |
| GET | `/api/config/export` | 导出脱敏配置 |
| POST | `/api/config/import` | 校验并导入配置 |
| POST | `/api/remote/send` | Web 远程发送 |
| POST | `/api/remote/permission` | Web/飞书权限审批 |
| ALL | `/:channelId?/proxy/*` | 上游代理请求 |

内部 channel API：

| 方法 | 路径 |
| --- | --- |
| POST | `/api/remote/channel/register` |
| GET | `/api/remote/channel/events` |
| POST | `/api/remote/channel/reply` |
| POST | `/api/remote/channel/delivery` |
| POST | `/api/remote/channel/permission-request` |
| POST | `/api/remote/channel/heartbeat` |
| POST | `/api/remote/channel/offline` |

## 本地数据

运行时数据都在 `~/.claude-proxy/`：

```text
~/.claude-proxy/
├── config.json   # 上游、通道、通知、remoteBridge
└── logs.db       # 日志、hooks、费用、远程 thread/message/card
```

SQLite 表包含 `logs`、`hooks`、`cost_records`、`session_cwds`、`projects`、`remote_threads`、`remote_messages`、`remote_channel_instances`、`remote_permissions`、`remote_message_cards`。

## 开发

```bash
npm install
npm run dev          # 后端开发模式
npm run dev:ui       # Vite UI 开发服务
npm test             # Jest
npm run build        # TypeScript + UI + macOS 状态栏（可用时）
npm run build:statusbar
```

2.4.0 发布前常用检查：

```bash
npx tsc --noEmit
npm test -- --runInBand
npx vite build
```

## 技术栈

- Node.js + TypeScript
- Express
- better-sqlite3
- Commander.js
- React + Vite
- 飞书开放平台 SDK
- Model Context Protocol SDK
- macOS Swift 状态栏助手

## License

MIT
