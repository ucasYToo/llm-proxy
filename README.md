# LLM Proxy

本地运行的 LLM API 代理，支持多目标管理、请求头/Body 参数注入、请求日志记录。

## 功能

- **多目标管理**：添加、编辑、删除转发目标，随时切换激活目标
- **Header 注入**：为每个目标配置额外请求头（如 `Authorization`），自动合并进转发请求
- **Body 注入**：为每个目标配置额外 Body 字段（如 `model`），自动合并进 JSON 请求体
- **请求日志**：记录每次代理请求的原始/修改后的 Headers、Body 及响应内容，支持分页和按目标过滤
- **流式响应**：透传 SSE 流式响应，不缓冲

## 快速开始

```bash
npm install
npm run dev     # 开发模式，http://localhost:1998
npm run build
npm start       # 生产模式，http://localhost:1998
```

## 使用方式

将客户端（如 OpenAI SDK）的 `base_url` 改为：

```
http://localhost:1998/proxy
```

所有请求会转发到当前激活目标的 Base URL，配置的 Headers 和 Body 参数自动注入。

**示例（Python）：**

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:1998/proxy", api_key="unused")
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
```

## 项目结构

```
src/
  app/
    page.tsx                    # 主页面（配置/日志两个标签页）
    layout.tsx                  # 根布局
    globals.css                 # 全局样式
    components/
      ConfigTab.tsx             # 目标管理界面
      LogsTab.tsx               # 日志查看界面
      TargetForm.tsx            # 添加/编辑目标弹窗
    proxy/[...path]/route.ts    # 代理核心逻辑
    api/
      query/route.ts            # GET 查询配置/日志，DELETE 清空日志
      set/route.ts              # POST 管理目标（增删改、切换激活）
  lib/
    types.ts                    # TypeScript 类型定义
    config.ts                   # 配置读写（data/config.json）
    logger.ts                   # 日志读写（data/logs.json）
data/
  config.json                   # 持久化配置（含 API Key，已 gitignore）
  logs.json                     # 请求日志（已 gitignore）
```

## API

### 代理

```
ANY /proxy/{path}  →  {activeTarget.url}/{path}
```

查询字符串原样传递，请求方法不限。

### 查询

```
GET /api/query?type=config              # 返回完整配置
GET /api/query?type=logs[&limit&offset&targetId]  # 分页查询日志
DELETE /api/query?type=logs             # 清空日志
```

### 配置管理

```
POST /api/set
  { action: "setActive",    targetId }
  { action: "addTarget",    target }
  { action: "updateTarget", target }
  { action: "deleteTarget", targetId }
```

## 配置格式

`data/config.json`（首次写入时自动创建）：

```json
{
  "activeTarget": "uuid",
  "targets": [
    {
      "id": "uuid",
      "name": "OpenAI",
      "url": "https://api.openai.com/v1",
      "headers": { "Authorization": "Bearer sk-xxx" },
      "bodyParams": { "model": "gpt-4o" }
    }
  ]
}
```

## 日志字段

每条日志记录包含：

| 字段 | 说明 |
|------|------|
| `originalRequestHeaders` | 客户端原始请求头 |
| `modifiedRequestHeaders` | 实际发送给上游的请求头（含注入字段） |
| `originalRequestBody` | 客户端原始请求体 |
| `modifiedRequestBody` | 实际发送给上游的请求体（含注入字段） |
| `responseStatus` | 上游响应状态码（0 表示请求失败） |
| `responseBody` | 上游响应体（流式请求记录为 `"[stream]"`） |
| `durationMs` | 请求耗时（毫秒） |
| `error` | 错误信息（仅请求失败时存在） |

日志最多保留 1000 条，超出自动丢弃最旧的记录。
