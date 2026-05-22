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

### Web 控制台

启动服务后访问 `http://localhost:1998`（默认端口），即可打开 Web 控制台。左侧边栏有三个页面：**配置**、**日志**、**Dashboard**。

#### 配置页

管理上游目标、通道和 Claude Code 集成。

**添加上游目标：**

1. 点击「添加目标」按钮
2. 填写表单：
   - **名称** - 目标的显示名（如 "OpenAI"、"Claude"）
   - **URL** - 上游 API 地址（如 `https://api.openai.com/v1`）
   - **认证方式** - 支持 Bearer Token / API Key / 自定义 Header，填入对应的 token 值
   - **模型映射**（可选）- 当请求的 model 字段匹配时，自动替换为目标模型（如统一映射到 `claude-opus-4-7`）
   - **Body 参数**（可选）- 额外注入到请求 body 的 JSON 字段（如 `{"temperature": 0.7}`）
3. 保存后，在目标列表中点击「设为活动」即可切换当前使用的上游

**通道管理：**

通道是代理的路由入口，每个通道绑定一个活动目标。可以在通道卡片上：

- 点击「接入代理」把 Claude Code 的 `ANTHROPIC_BASE_URL` 指向该通道的代理地址
- 点击「直连」恢复 Claude Code 直连上游（绕过代理）
- 点击「编辑」修改通道名称
- 点击「删除」移除通道

> 提示：切换通道的活动目标后，如果该通道已接入 Claude Code，代理会自动联动更新。

**日志采集设置：**

在配置页底部可以开关：
- **捕获原始请求体** - 记录未脱敏的请求/响应 body
- **捕获原始 SSE 流** - 记录完整的 SSE 事件流（调试用，可能较大）

#### 日志页

查看所有代理转发的请求/响应记录。支持：

- 按上游目标名称筛选
- 点击单条日志展开详情面板，查看完整的请求头、请求体、响应体和 token 用量
- 实时自动刷新（新日志通过 SSE 推送，无需手动刷新）

#### Dashboard 页

实时监控 Claude Code 的会话活动，按项目（工作目录）分组展示。

**工具栏设置：**

- **macOS 通知** - 勾选 Stop / SubagentStop / Notification，对应事件触发时会弹出系统通知
- **防止睡眠**（仅 macOS）- 开启后启动 `caffeinate`，锁屏/合盖也保持系统不睡眠，适合长时间任务
- **钉钉机器人** - 勾选启用后点击「配置」，填入 webhook 的 accessToken 和 secret，可点击「发送测试消息」验证
- **飞书机器人** - 勾选启用后点击「配置」，填入 webhook URL 和签名密钥（可选），同样支持测试

> 钉钉/飞书推送的事件和 macOS 通知一致（Stop / SubagentStop / Notification），并附带最后一条 assistant 回复内容。

**事件浏览：**

- 概览视图按项目分组，每个卡片显示该项目下的最近事件
- 点击项目卡片进入会话列表，选择具体会话查看完整时间线（hook 事件 + 代理日志混合排序）
- 顶部工具栏支持按事件类型过滤（如只看 `PostToolUse`）和关键词搜索
- 点击事件条目展开详情面板，查看完整的 hook payload 或请求/响应详情
- 点击「← 返回概览」回到项目分组视图

**关闭服务：** 点击左侧边栏底部的「关闭服务」按钮，会弹出确认对话框。服务关闭后需要重新 `claude-proxy start` 启动。

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
