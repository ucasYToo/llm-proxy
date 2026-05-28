# Changelog

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
