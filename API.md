# API.md

> 前后端唯一接口标准。Frontend 调接口、Backend 实现接口、Reviewer 核对接口，都以本文为准。

## 通用约定

- Base URL：开发环境 `http://localhost:3000`
- 请求与响应均为 JSON，字符集 UTF-8。
- 成功响应直接返回数据；错误响应统一为：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "人类可读的错误说明"
  }
}
```

- 状态码约定：`200` 成功，`201` 创建成功，`204` 删除成功，`400` 参数错误，`404` 资源不存在，`500` 服务器错误。

## 接口列表

### 1. 获取 Todo 列表

`GET /api/todos`

响应 `200`：

```json
{
  "items": [
    { "id": "1", "title": "写 API.md", "done": false, "createdAt": "2026-08-11T00:00:00.000Z" }
  ]
}
```

### 2. 创建 Todo

`POST /api/todos`

请求体：

```json
{ "title": "写 API.md" }
```

规则：`title` 必填，去空格后非空，长度不超过 100 字符。

响应 `201`：创建的完整 Todo 对象（同上结构）。

错误：`400`，`code: "VALIDATION_ERROR"`。

### 3. 删除 Todo

`DELETE /api/todos/:id`

规则：`id` 必须是字符串 ID（本项目使用递增字符串）。

响应 `204`，无响应体。

错误：`404`，`code: "NOT_FOUND"`。

## 前端静态资源

- `GET /` 返回前端页面。
- 前端不允许硬编码任何业务数据，只通过上述 API 获取。
