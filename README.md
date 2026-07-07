# claude-proxy

一个给 Claude Code 用的本地代理、Dashboard 和远程控制工具。

它主要解决中文互联网环境里的几个实际问题：多上游模型代理、Claude Code hook 可视化、费用统计、飞书通知，以及从 Web/飞书远程继续或新建本机 Claude Code 对话。

当前版本：**2.0.0**

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
- **Hook 管理**：一键写入 Claude Code hooks，捕获 SessionStart、工具调用、Stop 等事件。
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

## Dashboard

启动时带上 `--ui` 后，Dashboard 会由同一个代理进程提供。

- **配置**：管理上游目标、认证 header、模型映射、通道和项目目录路由。
- **日志**：查看代理请求、响应耗时、token、费用和原始 SSE 输出。
- **Dashboard**：按项目查看 Claude Code 会话、hook 事件和远程对话入口。
- **分析**：查看费用趋势、模型分布、会话排行和健康状态。
- **状态栏**：配置 macOS 状态栏助手和防休眠行为。

## 远程对话

远程对话的目标是：Web 或飞书里发一条消息，本机 Claude Code 在指定项目目录执行，并把过程和最终回复送回来。

链路图可以直接打开：[docs/remote-bridge-flow.html](docs/remote-bridge-flow.html)

### 当前执行链路

2.0.0 默认使用 CLI fallback：

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

### Dashboard 使用方式

1. 启动 `claude-proxy start --ui`。
2. 打开 Dashboard，进入远程/飞书配置区域。
3. 启用 Remote Bridge。
4. 配置 `allowedCwds` 和 `defaultCwd`。
5. 在项目卡或 session list 中新建远程对话，或继续已有会话。

### 飞书接入方式

飞书输入使用 **飞书自建应用长连接**，不是旧的飞书自定义机器人 webhook。自定义机器人只能做通知输出，不能作为稳定的消息输入入口。

飞书应用需要具备：

- 接收 `im.message.receive_v1` 事件
- 发送普通文本消息
- 发送交互卡片
- 更新已经发送的交互卡片

推荐配置步骤：

1. 在飞书开放平台创建自建应用。
2. 启用机器人能力，打开消息事件订阅。
3. 在 Dashboard 的远程配置表单中填入 `appId`、`appSecret`，以及可选的 `encryptKey`、`verificationToken`。
4. 把机器人加入私聊或群聊。
5. 私聊默认继续最近 active thread；群聊里需要 @bot 或回复 bot 消息。

飞书支持的命令：

```text
/help
/status
/projects
/new <项目别名或路径> <prompt>
/continue <threadId> <prompt>
/use <threadId>
同意 <permissionId>
拒绝 <permissionId>
```

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
    "defaultCwd": "/Users/me/workspace/project",
    "claudeCommand": "claude",
    "permissionMode": "default",
    "deliveryMode": "cli",
    "feishu": {
      "enabled": true,
      "appId": "...",
      "appSecret": "...",
      "encryptKey": "...",
      "verificationToken": "...",
      "ingress": "longConnection",
      "allowedUserIds": [],
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
- `allowedCwds` 尽量收窄；为空时只允许 `defaultCwd`。
- 群聊场景建议配置 `allowedUserIds`，避免任意群成员触发本机 Claude Code。

## Hook 管理

```bash
claude-proxy hook install --port 1998
claude-proxy hook status
claude-proxy hook uninstall
```

当前管理的 hook 事件：

```text
SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Notification /
SubagentStart / SubagentStop / Stop / SessionEnd
```

## 上游目标和通道路由

```bash
claude-proxy config list
claude-proxy config add --name "OpenAI" \
  --url "https://api.openai.com/v1" \
  --headers '{"Authorization":"Bearer sk-xxx"}' \
  --anthropic-model "claude-opus-4-7"
claude-proxy config set-active <target-id>
claude-proxy config delete <target-id>

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
| GET | `/api/query?type=sessions` | 最近会话 |
| GET | `/api/query?type=remote-threads` | 远程对话 thread |
| GET | `/api/query?type=remote-messages` | 远程消息 |
| GET | `/api/query?type=remote-instances` | 远程 channel instance |
| GET | `/api/events` | Dashboard SSE |
| POST | `/api/hooks/:event` | Claude Code hook 回调 |
| POST | `/api/set` | 修改配置 |
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

2.0.0 发布前常用检查：

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
