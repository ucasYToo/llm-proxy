# claude-proxy

LLM Proxy CLI - 代理转发和日志管理工具。将 LLM API 请求通过本地代理服务器转发到上游服务（OpenAI、Anthropic 等），支持配置管理、日志记录和流式响应。

## 功能特性

- **请求代理** - 转发请求到上游 LLM API
- **目标管理** - 配置多个转发目标，支持 Headers 和 Body 参数注入
- **流式响应** - SSE 流式响应的拦截、解析和组装
- **日志记录** - 完整的请求/响应日志，包括 token 使用量统计
- **CLI 工具** - 通过命令行管理配置和查看日志

## 安装

### 全局安装

```bash
npm install -g .
```

### 本地运行

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

**选项：**

| 选项 | 描述 | 默认值 |
|------|------|--------|
| `-p, --port <number>` | 监听端口 | 1998 |
| `--host <address>` | 绑定地址 | localhost |

**示例：**

```bash
claude-proxy start --port 3000 --host 0.0.0.0
```

### 配置管理

```bash
claude-proxy config <action> [options]
```

**可用操作：**

| 命令 | 描述 |
|------|------|
| `list` | 列出所有目标 |
| `add` | 添加新目标 |
| `set-active` | 设置活动目标 |
| `delete` | 删除目标 |
| `show` | 显示目标详情 |

**添加目标：**

```bash
claude-proxy config add \
  --name "OpenAI" \
  --url "https://api.openai.com/v1" \
  --headers '{"Authorization":"Bearer sk-xxx"}' \
  --body-params '{"temperature":0.7}'
```

**设置活动目标：**

```bash
claude-proxy config set-active <target-id>
```

### 日志查看

```bash
claude-proxy logs [options]
```

**选项：**

| 选项 | 描述 | 默认值 |
|------|------|--------|
| `-l, --limit <number>` | 限制条数 | 50 |
| `--target <name>` | 按目标筛选 | - |
| `--json` | JSON 格式输出 | false |

**示例：**

```bash
claude-proxy logs --limit 10
claude-proxy logs --json
claude-proxy logs --target "OpenAI"
```

**清空日志：**

```bash
claude-proxy clear-logs
```

## API 端点

服务器启动后，可通过以下端点访问：

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/query?type=config` | 查询配置 |
| GET | `/api/query?type=logs` | 查询日志 |
| POST | `/api/set` | 修改配置 |
| ALL | `/proxy/*` | 代理请求 |

### 代理请求示例

```bash
curl http://localhost:1998/proxy/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
```

### 查询配置

```bash
curl "http://localhost:1998/api/query?type=config"
```

### 查询日志

```bash
curl "http://localhost:1998/api/query?type=logs"
```

## 配置存储

配置和日志存储在本地文件中：

```
~/.claude-proxy/
├ config.json    # 目标和设置
└ logs.json      # 请求日志
```

### 配置结构 (config.json)

```json
{
  "activeTarget": "target-id",
  "targets": [
    {
      "id": "uuid",
      "name": "OpenAI",
      "url": "https://api.openai.com/v1",
      "headers": { "Authorization": "Bearer xxx" },
      "bodyParams": { "temperature": 0.7 }
    }
  ],
  "logCollection": {
    "captureOriginalBody": false,
    "captureRawStreamEvents": false
  }
}
```

## 开发

### 构建

```bash
npm run build
```

### 开发模式

```bash
npm run dev
```

### 测试

```bash
npm test
```

## 技术栈

- **Node.js** - 运行时
- **TypeScript** - 类型安全
- **Express.js** - HTTP 服务器
- **Commander.js** - CLI 框架
- **chalk** - 终端颜色
- **ora** - 加载动画
- **fs-extra** - 文件操作
- **uuid** - UUID 生成

## 许可证

MIT
