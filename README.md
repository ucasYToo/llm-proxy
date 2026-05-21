# claude-proxy

LLM Proxy CLI - 代理转发和日志管理工具。将 LLM API 请求通过本地代理服务器转发到上游服务，支持 Claude Code hook 集成、多通道管理、通知推送和 Web 控制台。

## 功能特性

- **请求代理** - 转发请求到上游 LLM API，支持代理模式和直连模式
- **Claude Code Hook 集成** - 自动注册 hook 到 Claude Code，捕获会话事件
- **多通道管理** - 支持多个独立通道，每个通道绑定不同的上游目标
- **实时通知** - macOS 系统通知 + 钉钉机器人推送（Stop / SubagentStop / Notification 事件）
- **Web 控制台** - 内置 Dashboard，实时 SSE 事件流、日志查看、配置管理
- **流式响应** - SSE 流式响应的拦截、解析和组装
- **日志记录** - 完整的请求/响应日志（SQLite 存储），包括 token 使用量统计
- **防休眠** - 可选的 caffeinate 机制，防止 Mac 在任务执行期间休眠

## 安装

```bash
npm install -g .
```

或本地运行：

```bash
npm install
npm run build
node bin/cli.js --help
```

## 使用方法

### 启动代理服务器

```bash
claude-proxy start [options]
```

| 选项 | 描述 | 默认值 |
|------|------|--------|
| `-p, --port <number>` | 监听端口 | 1998 |
| `--host <address>` | 绑定地址 | localhost |
| `--ui` | 启用 Web UI（默认开启） | true |

### Hook 管理

将本工具的 HTTP hook 注册到 Claude Code（写入 `~/.claude/settings.json`），捕获会话事件。

```bash
claude-proxy hook install   # 注册 hook
claude-proxy hook status    # 查看已注册的 hook
claude-proxy hook uninstall # 移除所有 hook
```

注册的 hook 事件：`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd`

### 配置管理

```bash
claude-proxy config <action> [options]
```

**目标操作：**

| 命令 | 描述 |
|------|------|
| `list` | 列出所有目标 |
| `add` | 添加新目标 |
| `set-active` | 设置活动目标 |
| `delete` | 删除目标 |
| `show` | 显示当前配置 |

添加目标示例：

```bash
claude-proxy config add \
  --name "OpenAI" \
  --url "https://api.openai.com/v1" \
  --headers '{"Authorization":"Bearer sk-xxx"}' \
  --body-params '{"temperature":0.7}' \
  --anthropic-model "claude-opus-4-7"
```

**通道管理：**

```bash
claude-proxy config channel list                  # 列出所有通道
claude-proxy config channel add --name "测试"      # 添加通道
claude-proxy config channel set-active \
  --channel <channelId> --target <targetName>     # 设置通道的活动目标
claude-proxy config channel delete \
  --channel <channelId>                           # 删除通道
```

### 日志查看

```bash
claude-proxy logs [options]
claude-proxy clear-logs
```

| 选项 | 描述 | 默认值 |
|------|------|--------|
| `-l, --limit <number>` | 限制条数 | 20 |
| `-t, --target <name>` | 按目标筛选 | - |
| `--json` | JSON 格式输出 | false |

## API 端点

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/query?type=config` | 查询配置 |
| GET | `/api/query?type=logs` | 查询日志 |
| GET | `/api/query?type=hooks` | 查询 hook 事件 |
| GET | `/api/query?type=sessions` | 查询最近会话 |
| GET | `/api/query?type=session-timeline` | 查询会话时间线（hook+log） |
| GET | `/api/query?type=caffeinate` | 查询防休眠状态 |
| GET | `/api/events` | SSE 实时事件流 |
| POST | `/api/hooks/:event` | Claude Code hook 回调入口 |
| POST | `/api/set` | 修改配置 |
| DELETE | `/api/query?type=logs` | 清空日志 |
| DELETE | `/api/query?type=hooks` | 清空 hook 事件 |
| POST | `/api/shutdown` | 关闭服务器 |
| ALL | `/:channelId?/proxy/*` | 代理请求（按通道） |

### 代理请求示例

```bash
# 默认通道
curl http://localhost:1998/proxy/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'

# 指定通道
curl http://localhost:1998/my-channel/proxy/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
```

## 配置存储

```
~/.claude-proxy/
├ config.sqlite   # 配置和日志（SQLite）
└ ...
```

### 配置结构

```json
{
  "activeTarget": "target-id",
  "claudeCodeChannelId": "default",
  "targets": [
    {
      "id": "uuid",
      "name": "OpenAI",
      "url": "https://api.openai.com/v1",
      "headers": {},
      "bodyParams": {},
      "anthropicModel": "claude-opus-4-7",
      "auth": {
        "type": "bearer",
        "headerName": "Authorization",
        "value": "sk-xxx"
      }
    }
  ],
  "channels": [
    {
      "id": "default",
      "name": "默认通道",
      "activeTarget": "target-id"
    }
  ],
  "logCollection": {
    "captureOriginalBody": false,
    "captureRawStreamEvents": false
  },
  "notifications": {
    "stop": true,
    "subagentStop": true,
    "notification": true,
    "dingtalk": {
      "enabled": false,
      "accessToken": "",
      "secret": ""
    }
  }
}
```

## Claude Code 集成

通过 `hook install` 注册后，claude-proxy 会自动接管 Claude Code 的环境变量。在 Web UI 中可以：

- **接入代理**：将 Claude Code 的 `ANTHROPIC_BASE_URL` 指向代理，请求经过代理转发并记录日志
- **切到直连**：恢复 Claude Code 直连上游，绕过代理
- **切换目标**：更换通道的活动目标后，自动联动更新 Claude Code 配置
- **防休眠**：开启 caffeinate 防止 Mac 在长时间任务中休眠

## 通知系统

### macOS 系统通知

在 Web UI 中启用后，以下事件会推送系统通知：
- **Stop** - 主任务完成
- **SubagentStop** - 子代理完成
- **Notification** - Claude Code 通知

### 钉钉机器人

配置钉钉机器人 webhook 后，同样的事件会推送到钉钉群，并附带最后一条 assistant 回复内容。

## 开发

```bash
npm run build     # 构建
npm run dev       # 开发模式
npm run dev:ui    # UI 开发模式
npm test          # 测试
```

## 技术栈

- **Node.js** + **TypeScript** - 运行时与类型安全
- **Express.js** - HTTP 服务器
- **better-sqlite3** - SQLite 数据存储
- **Commander.js** + **chalk** + **ora** - CLI 框架
- **React** + **Vite** - Web 控制台
- **SSE** - 实时事件推送

## 许可证

MIT
