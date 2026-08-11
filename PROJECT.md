# PROJECT.md

> 每个新项目的第一份文档。写项目目标和主要需求，Frontend / Backend / Reviewer 三个角色开工前都要先读。

## 项目目标

验证多模型 AI 编程环境的端到端可用性：一个最小 Todo 应用，前端负责界面，后端负责 API，Reviewer 独立检查。

## 主要需求

### 功能
- 前端页面可以列出、添加、删除 Todo。
- 后端提供 JSON API：`GET /api/todos`、`POST /api/todos`、`DELETE /api/todos/:id`。
- 页面有 Loading / Empty / Error 三种状态。
- 手机和电脑都能正常使用（简单响应式）。

### 技术
- 后端：Node.js 原生 HTTP Server，无第三方依赖。
- 前端：原生 HTML / CSS / JavaScript。
- 测试：Node 内置 `node --test`，无第三方依赖。

## 工作规则（所有模型必须遵守）

1. 不确定 API、Library、函数是否存在时，不允许猜，先检查代码、依赖或官方文档。
2. 修改代码以后必须实际运行必要的 Build / Test / Lint。
3. 测试失败不能宣布完成。
4. 不允许删除失败测试或关闭检查来掩盖问题。
5. 前后端接口以 API.md 为准，接口变更必须同步更新 API.md。
6. GPT Reviewer 使用独立上下文检查，不直接相信开发模型自己的结论。
7. API Key 等敏感信息只允许放在 `.env` 或本地环境变量，禁止写入代码或提交进 Git。

## 验收标准

- `npm test` 全部通过。
- 前端三个状态（Loading / Empty / Error）都可见可测。
- API 行为与 API.md 完全一致。
- REVIEW.md 中无未解决的 P0 / P1 问题。
