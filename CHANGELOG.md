# Changelog

## 2.1.2 (2026-07-13)

### 修复

- 修复 CLI fallback 中 Claude 已通过 `remote_reply` 回传时，代理仍会再发送 CLI 最终文本，导致飞书出现重复最终回复的问题。

## 2.1.1 (2026-07-10)

### 新增

- Dashboard 飞书远程配置支持按机器人默认项目目录安装、更新和移除 `feishu-remote` Claude skill，不再要求用户手动走 CLI。
- Feishu Remote Bridge 为 CLI fallback 注入远程 thread/message/bot/chat/cwd 上下文，skill 可通过受保护的本机 API 把项目目录内文件回传到原飞书会话。
- 新增 `/api/remote/feishu/send-file` 内部接口，校验文件必须位于当前远程项目目录内并遵守飞书 30MB 上传限制。

### 变更

- 飞书远程回传文件会上传为飞书文件消息，仍保持进度卡片与最终文本回复分离。
- 飞书 `/status` 会显示当前用户飞书 ID、远程对话 ID、Chat ID 和消息链 ID，方便诊断远程上下文。

## 2.1.0 (2026-07-07)

### 新增

- Remote Bridge 飞书入口支持配置多个自建应用机器人，每个机器人独立默认项目路径、app 凭证、白名单和测试 Chat ID。

### 变更

- Dashboard 远程配置面板改为常用配置外置、每个机器人独立高级配置展开，降低多机器人配置时的挤压。
- Dashboard 不再配置 Web 默认路径；Web 远程对话直接使用项目卡或 session 上下文的 cwd，飞书默认路径归属到各机器人。
- Dashboard 项目卡的远程对话入口改为更紧凑的 `+ 远程` 操作，减少卡片头部挤压。
- 飞书多机器人场景下会按来源机器人发送后续文本和卡片更新，避免不同机器人之间串回复。
- 飞书 `/projects`、`/threads`、`/sessions` 这类列表返回改为原生表格卡片；`/sessions` 展示 session id、项目、时间、标题和 10 字最后回复摘要，并把进度卡片最小更新间隔从 1000ms 降到 210ms。

## 2.0.1 (2026-07-07)

### 新增

- 飞书远程命令新增 `/threads`、`/show`、`/stop`，支持查看当前聊天可见的远程 thread、查看详情和停止运行中的 CLI fallback 任务。
- 飞书远程命令新增 `/sessions`、`/use-session`、`/continue-session`，支持在飞书中绑定并继续本机已有 Claude Code session。
- Dashboard 继续本地 session 时会把选中的 `claudeSessionId` 传入 Remote Bridge，新建 remote thread 后通过 `claude -p --resume <sessionId>` 续上本地会话。

### 变更

- 启动日志默认改为精简模式，只显示关键地址、状态栏状态和异常请求；`--verbose` 可查看端点列表和每请求访问日志。
- 飞书 `/help` 文案重写，明确区分远程 thread、本地 Claude session、项目、审批和停止命令。
- 飞书 `/projects` 复用 Dashboard 项目发现逻辑，列出已发现项目；项目备注可作为 `/new` 别名。
- Remote Bridge CLI 模式允许启动 Dashboard 已发现项目，`allowedCwds` 作为补充固定目录使用。
- Dashboard session list 的远程继续逻辑改为只匹配相同 `claudeSessionId` 的 remote thread，避免同 cwd 误续到其他远程对话。
- Dashboard 暂时隐藏 Remote Bridge 的 MCP channel 安装/安装并启动入口，避免默认 CLI fallback 路径下误写 `.mcp.json`。

### 修复

- 修复飞书 `/threads` 等未实现命令被误投递给 Claude，导致 `Unknown command` 的问题。
- 修复 `/use <threadId>` 只刷新时间、不真正绑定当前飞书聊天上下文的问题。

## 2.0.0 (2026-07-07)

### 新增

- **Web/飞书远程对话** — 支持从 Dashboard 或飞书继续现有 Claude Code 会话，也支持按项目新建远程对话。
- **Remote Bridge 配置** — 新增 `remoteBridge` 配置，包含 `authToken`、Web 入口、`allowedCwds`、`defaultCwd`、`claudeCommand`、`permissionMode`、`deliveryMode` 和飞书自建应用长连接配置。
- **飞书自建应用接入** — 支持长连接接收 `im.message.receive_v1`，DM 默认继续最近活跃 thread，群聊仅处理 @bot/回复链路。
- **飞书进度卡片** — 每条飞书入站消息创建一张紧凑进度卡片，持续更新排队、运行、工具摘要、过程、错误和耗时；最终回复以普通聊天文本发送。
- **远程命令** — 支持 `/help`、`/status`、`/projects`、`/new`、`/continue`、`/use`，以及 `同意/拒绝 <permissionId>` 权限回复。
- **Remote Bridge 存储表** — 新增 `remote_threads`、`remote_messages`、`remote_channel_instances`、`remote_permissions`、`remote_message_cards`。
- **Remote API** — 新增 Web 发送、权限审批、remote query、channel register/events/reply/delivery/permission/heartbeat/offline API。
- **MCP channel 实验路径** — 新增 `claude-proxy-channel` binary 和 `claude-proxy channel install/status`，用于 Claude Code channels 可用时的双向消息注入。

### 变更

- Remote Bridge 默认使用 `cli` delivery mode，通过 `claude -p --output-format stream-json --verbose --include-partial-messages --include-hook-events` 获取可观察进度。
- Dashboard 远程对话入口融入项目卡和 session list，远程状态以轻量标记显示。
- Feishu 输出不再使用话题回复；进度卡和最终答案都发送到主会话，避免制造大量话题。
- 进度卡 patch 采用 1 秒合并式尾随更新，降低卡顿并保持低于飞书单消息频控。
- 收紧本地管理面安全边界：移除默认全域 CORS、阻止跨站写请求、隐藏配置响应中的 remote token，channel SSE 不再通过 URL query 传 token。
- README、CLAUDE.md 和 AGENTS.md 更新到 2.0 架构与发布流程。

### 修复

- 修复 Claude CLI fallback 使用 `stream-json` 时缺少 `--verbose` 导致执行失败的问题。
- 修复飞书卡片更新过频时持续刷降级文本的问题，现在同一卡片失败提示只发送一次。
- 修复进度卡片布局过高、最终回复重复展示在卡片内的问题。

## 1.3.0 (2026-05-29)

### 新增

- **费用追踪系统** — 每次请求自动记录 token 用量与费用（USD），内置主流模型定价表
  - 支持按会话 / 目标 / 模型 / 时间段聚合统计
  - 费用趋势图、模型分布饼图、Top 会话排行
- **预算控制** — 设置每日 / 每月预算上限（USD），超阈值自动告警
  - 支持自定义 Target 级别的定价覆盖
- **macOS 状态栏应用** — 原生 Swift 应用，实时显示当前模型、今日费用和请求状态
  - `--no-statusbar` 选项可禁用
- **会话分析面板** — 深度分析单个会话的性能指标
  - 健康度仪表盘（成功率、缓存命中率、延迟、错误率）
  - Token 时间线、工具调用热力图、子代理瀑布图
- **飞书机器人通知** — webhook 推送，支持签名校验
- **通知事件独立配置** — macOS / 钉钉 / 飞书三个通道可分别勾选响应的事件类型

### 变更

- 存储引擎从 JSON 文件迁移到 SQLite（`config.sqlite`），性能和可靠性提升
- 日志最大保留条数调整为 300（可配置）
- 分析页独立为侧边栏 Tab，与 Dashboard 分离

### 修复

- 修复 hop-by-hop 头部未过滤导致上游请求失败的问题
- 修复 `content-length` 缺失导致 HTTPS 校验不通过的问题

## 1.2.0 (2025-05)

### 新增

- **Claude Code Hook 集成** — 自动注册 hook 到 `~/.claude/settings.json`，捕获完整会话事件
  - 支持事件：SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Notification / SubagentStart / SubagentStop / Stop / SessionEnd
- **多通道管理** — 多个独立路由通道，每个通道绑定不同上游目标
  - 支持自定义通道 ID，按通道代理请求
- **实时通知** — macOS 系统通知 + 钉钉机器人推送
  - Stop / SubagentStop / Notification 事件触发通知
  - 钉钉推送附带最后一条 assistant 回复内容
- **Dashboard 页** — 实时 SSE 事件流，按项目分组展示会话活动
  - 事件过滤、关键词搜索、会话时间线（hook + 代理日志混合排序）
- **防休眠** — 可选 caffeinate，防止 Mac 在长时间任务中休眠
- **Web UI 全面重构** — 侧边栏导航、Dashboard Tab、事件流组件

### 变更

- 项目结构重构，分离 CLI 命令 / 服务器 / 代理 / 配置模块
- SSE 流式响应拦截与组装逻辑优化

## 1.1.0 (2025-04)

### 新增

- **通道管理** — 支持多通道配置和按通道 ID 应用 Claude Code 代理
- **ANTHROPIC_MODEL 同步** — 切换目标时自动同步模型名到 Claude Code 设置
- **配置页重新设计** — 工业风格 UI，配置项复制功能
- **Web UI 构建** — Vite + React 构建产物，`--ui` 选项直接服务静态文件

### 变更

- 包名更新为 `llm-proxy-view`，发布到 npm
- CLI 版本号动态读取 `package.json`，支持 `-v` 简写

## 1.0.3 (2025-03)

### 修复

- 修复 hop-by-hop 头部未过滤导致上游请求失败
- 修复 `content-length` 缺失导致 HTTPS 校验不通过
- 允许空测试套件通过

## 1.0.2 (2025-03)

### 新增

- 日志详情模态框，JSON 差异比较
- 日志收集配置（原始请求体 / SSE 流捕获开关）
- Token 用量展示
- 配置项复制功能与快捷键标签

### 变更

- 组件样式模块化
- 日志最大条目数调整为 100

## 1.0.0 (2025-03)

### 初始发布

- LLM API 请求代理转发
- 多上游目标配置管理
- SSE 流式响应拦截与组装
- 请求 / 响应日志记录（JSON 存储）
- Web 控制台（配置 / 日志查看）
