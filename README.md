# claude-proxy

LLM Proxy CLI — 为 Claude Code 设计的本地代理网关，支持多目标路由、费用追踪、实时通知和 Web 控制台。

## 功能特性

- **请求代理** — 转发 LLM API 请求到上游服务，支持直连和代理两种模式
- **多通道管理** — 多个独立路由通道，每个通道绑定不同上游目标，可独立切换
- **费用追踪** — 自动记录每次请求的 token 用量与费用（USD），支持按会话 / 目标 / 模型 / 时间段聚合统计
- **预算控制** — 设置每日 / 每月预算上限，超出阈值自动告警
- **macOS 状态栏** — 原生 Swift 应用，实时显示当前模型、今日费用和请求状态
- **会话分析** — 会话健康度评估、Token 时间线、工具调用热力图、子代理瀑布图
- **Claude Code Hook** — 自动注册 hook，捕获完整会话生命周期事件
- **实时通知** — macOS 系统通知 / 钉钉机器人 / 飞书机器人，多通道独立配置
- **Web 控制台** — 内置 Dashboard，实时 SSE 事件流、费用分析、配置管理
- **防休眠** — 可选 caffeinate，Mac 长时间任务不休眠

## 安装

```bash
npm install -g llm-proxy-view
```

或本地开发运行：

```bash
npm install
npm run build
node bin/cli.js --help
```

## 快速开始

```bash
# 1. 启动服务
claude-proxy start

# 2. 打开 Web 控制台（默认 http://localhost:1998）
# 3. 在「配置」页添加上游目标（如 OpenAI / Anthropic）
# 4. 点击「接入代理」将 Claude Code 指向代理
# 5. 开始使用 Claude Code，请求自动经过代理记录
```

## 启动选项

```bash
claude-proxy start [options]
```

| 选项 | 描述 | 默认值 |
|------|------|--------|
| `-p, --port <number>` | 监听端口 | `1998` |
| `--host <address>` | 绑定地址 | `localhost` |
| `--ui` | 启用 Web UI | `true` |
| `--no-statusbar` | 禁用 macOS 状态栏应用 | 启用 |

## Web 控制台

启动服务后访问 `http://localhost:1998`，包含以下页面：

### 配置页

管理上游目标、通道和 Claude Code 集成。

**添加上游目标：**

1. 点击「添加目标」
2. 填写名称、URL、认证方式（Bearer Token / API Key / 自定义 Header）
3. 可选配置模型映射和额外 Body 参数
4. 保存后在目标列表中点击「设为活动」切换上游

**通道管理：**

每个通道是一个独立的路由入口，绑定一个活动目标：

- **接入代理** — 将 Claude Code 的 `ANTHROPIC_BASE_URL` 指向该通道的代理地址
- **切到直连** — 恢复 Claude Code 直连上游，绕过代理
- 切换通道的活动目标后，已接入的 Claude Code 会自动联动更新

**日志采集设置：**

- **捕获原始请求体** — 记录未脱敏的请求/响应 body
- **捕获原始 SSE 流** — 记录完整的 SSE 事件流

### 日志页

查看所有代理请求记录，支持按目标筛选、实时 SSE 推送、点击展开详情查看完整请求头和 token 用量。

### Dashboard 页

实时监控 Claude Code 会话活动，按项目分组展示。

**通知设置：**

| 通道 | 支持的事件 | 配置项 |
|------|-----------|--------|
| macOS 系统通知 | Stop / SubagentStop / Notification | 按事件独立勾选 |
| 钉钉机器人 | 同上 | webhook accessToken + secret |
| 飞书机器人 | 同上 | webhook URL + 签名密钥 |

> 各通道的通知事件独立配置，互不影响。推送内容包含事件类型和最后一条 assistant 回复。

**其他设置：**

- **防休眠**（仅 macOS）— 启动 `caffeinate`，锁屏 / 合盖保持系统不睡眠
- **事件过滤** — 按事件类型过滤、关键词搜索

### 分析页

费用与性能分析面板：

- **费用概览** — 今日 / 本周 / 本月总费用，预算使用进度
- **费用趋势图** — 按时间维度的费用折线图
- **模型分布** — 各模型费用占比
- **目标费用表** — 按上游目标聚合的费用统计
- **Top 会话** — 费用最高的会话列表

### 会话分析面板

点击会话进入深度分析：

- **健康度仪表盘** — 成功率、缓存命中率、平均延迟、错误率
- **Token 时间线** — 每次请求的 token 用量变化趋势
- **工具热力图** — 各工具调用频次分布
- **子代理瀑布图** — 子代理的启动 / 结束时间线

### 状态栏面板

macOS 状态栏应用的配置与状态展示，显示实时费用、当前模型和运行状态。

## Hook 管理

将 HTTP hook 注册到 Claude Code，自动捕获会话事件：

```bash
claude-proxy hook install    # 注册 hook
claude-proxy hook status     # 查看已注册 hook
claude-proxy hook uninstall  # 移除所有 hook
```

注册的事件：`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Notification` / `SubagentStart` / `SubagentStop` / `Stop` / `SessionEnd`

## 配置管理

```bash
# 目标操作
claude-proxy config list                                    # 列出所有目标
claude-proxy config add --name "OpenAI" \                   # 添加目标
  --url "https://api.openai.com/v1" \
  --headers '{"Authorization":"Bearer sk-xxx"}' \
  --anthropic-model "claude-opus-4-7"
claude-proxy config set-active <target-id>                  # 设置活动目标
claude-proxy config delete <target-id>                      # 删除目标

# 通道管理
claude-proxy config channel list                            # 列出所有通道
claude-proxy config channel add --name "测试"                # 添加通道
claude-proxy config channel set-active \                    # 设置通道活动目标
  --channel <channelId> --target <targetName>
claude-proxy config channel delete --channel <channelId>    # 删除通道
```

## 日志查看

```bash
claude-proxy logs [options]
claude-proxy clear-logs
```

| 选项 | 描述 | 默认值 |
|------|------|--------|
| `-l, --limit <number>` | 限制条数 | `20` |
| `-t, --target <name>` | 按目标筛选 | — |
| `--json` | JSON 格式输出 | `false` |

## API 端点

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/query?type=config` | 查询配置 |
| GET | `/api/query?type=logs` | 查询日志 |
| GET | `/api/query?type=hooks` | 查询 hook 事件 |
| GET | `/api/query?type=sessions` | 查询最近会话 |
| GET | `/api/query?type=session-timeline` | 查询会话时间线 |
| GET | `/api/query?type=caffeinate` | 查询防休眠状态 |
| GET | `/api/query?type=cost-summary` | 查询费用汇总 |
| GET | `/api/query?type=cost-trend` | 查询费用趋势 |
| GET | `/api/query?type=cost-session` | 查询会话费用明细 |
| GET | `/api/query?type=session-analytics` | 查询会话分析数据 |
| GET | `/api/query?type=pricing` | 查询定价信息 |
| GET | `/api/events` | SSE 实时事件流 |
| POST | `/api/hooks/:event` | Claude Code hook 回调 |
| POST | `/api/set` | 修改配置 |
| DELETE | `/api/query?type=logs` | 清空日志 |
| DELETE | `/api/query?type=hooks` | 清空 hook 事件 |
| DELETE | `/api/query?type=cost` | 清空费用记录 |
| POST | `/api/shutdown` | 关闭服务器 |
| ALL | `/:channelId?/proxy/*` | 代理请求（按通道） |

## 配置存储

所有数据存储在 `~/.claude-proxy/` 目录，使用 SQLite 格式：

```
~/.claude-proxy/
├── config.sqlite    # 配置、日志、费用记录
└── ...
```

## 开发

```bash
npm install
npm run dev          # 后端开发模式（tsx）
npm run dev:ui       # UI 开发模式（vite）
npm run build        # 构建
npm run build:swift  # 编译 macOS 状态栏应用
npm run build:all    # 构建全部（后端 + UI + Swift）
npm test             # 测试
```

## 技术栈

- **Node.js** + **TypeScript** — 运行时与类型安全
- **Express.js** — HTTP 服务器
- **better-sqlite3** — SQLite 数据存储
- **Commander.js** + **chalk** + **ora** — CLI 框架
- **React** + **Vite** — Web 控制台
- **Swift** — macOS 状态栏原生应用
- **SSE** — 实时事件推送

## 许可证

MIT
