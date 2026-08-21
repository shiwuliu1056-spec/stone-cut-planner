# 石材下料工具 API 文档

本文档由前端根据页面业务需求整理，供后端开发或维护参考。

## 基础说明
- 所有接口响应应当使用 JSON 格式（除文件下载接口外）。
- 错误时请返回 `{"error": "错误信息内容"}`，并尽量使用合适的 HTTP 状态码 (例如 400 Bad Request)。

---

## 1. 导入小料清单 (Excel)
**接口**: `POST /api/import`

**说明**: 前端将用户选择的 Excel 文件直接作为二进制流发送，后端负责解析该 Excel 并提取小料的编号、尺寸、数量。所有尺寸和数量必须被解析为正整数。

**请求头**:
- `Content-Type: application/octet-stream`

**请求体**: 
Excel 文件的二进制数据 (ArrayBuffer / Blob)

**响应数据 (成功 - 200 OK)**:
```json
{
  "parts": [
    {
      "id": "A",
      "w": 1400,
      "h": 600,
      "qty": 13
    },
    {
      "id": "B",
      "w": 1750,
      "h": 450,
      "qty": 13
    }
  ]
}
```

---

## 2. 自动排版计算
**接口**: `POST /api/solve`

**说明**: 根据用户在页面上配置的大板和小料参数，进行切割排版计算，返回完整的排版图元数据。

**请求头**:
- `Content-Type: application/json`

**请求体**:
```json
{
  "settings": {
    "slabs": [
      {
        "id": "甲",
        "w": 2700,
        "h": 1800,
        "limit": null
      }
    ]
  },
  "parts": [
    {
      "id": "A",
      "w": 1400,
      "h": 600,
      "qty": 13,
      "rotatable": true
    }
  ]
}
```
*注：`limit` 代表大板可用数量上限，`null` 或空字符串代表不限。部分旧版高级参数 (`overcut`, `kerf`, `iterations`) 已被弃用（后端兼容忽略），`minOffcut`, `sampleSide`, `stripSide` 彻底移除。*

**响应数据 (成功 - 200 OK)**:
```json
{
  "result": {
    "plans": {
      "A": {
        "stats": {
          "slabCount": 1,
          "offcutCount": 2,
          "offcutArea": 1250000
        },
        "slabs": [
          {
            "id": "甲",
            "index": 1,
            "w": 2700,
            "h": 1800,
            "placements": [
              { "id": "A", "instance": "A-1", "x": 0, "y": 0, "w": 1400, "h": 600 }
            ],
            "cuts": [
              { "x1": 0, "y1": 600, "x2": 1400, "y2": 600 }
            ],
            "allOffcuts": [
              { "id": "R01", "x": 1400, "y": 0, "w": 1300, "h": 1800 }
            ]
          }
        ]
      }
    }
  }
}
```
*注：前端使用 `result.plans.A` 进行结果展示。返回的余料中 `reusable` 字段已被弃用（若返回固定为 `true`）。*

---

## 3. 导出相关接口 (Excel & Word)

导出功能需要生成两种类型的文件，当前采取的是由前端生成包含排版渲染图 Base64 数据的请求发给后端，后端生成文档返回流。

### 3.1 导出 Excel 尺寸表
**接口**: `POST /api/export`
**说明**: 将排版结果和图表转化为 Excel 下载。
**请求头**: `Content-Type: application/json`
**请求体**: 
```json
{
  "result": { /* /api/solve 返回的完整 result 对象 */ },
  "images": {
    "A": ["data:image/png;base64,iVBORw0KGgo...", "data:image/png;base64,..."]
  }
}
```
**响应**: 返回 `.xlsx` 文件的二进制 Blob 流，无 JSON 包装。

### 3.2 导出 Word 排版图
**接口**: `POST /api/export-word`
**说明**: 将排版图数据汇总为 Word 下载，请求体格式与上面完全一致。
**请求头**: `Content-Type: application/json`
**请求体**: 同 `/api/export`
**响应**: 返回 `.docx` 文件的二进制 Blob 流，无 JSON 包装。

---

## 4. 系统级操作 (按需实现)

*为保障桌面端或特定客户端的需求，保留了以下维护级接口。*

### 4.1 退出程序
**接口**: `POST /api/shutdown`
**说明**: 供本地运行环境彻底关闭后台 Node/Web 服务器进程。

### 4.2 检查与执行更新 (可选)
- `GET /api/update/check` : 获取版本信息 `{"currentVersion": "1.0.0", "update": {"version": "1.1.0"}, "supported": true, "configured": true}`
- `POST /api/update/apply` : 触发下载/更新逻辑
- `GET /api/update/progress` : 获取更新进度 `{"phase": "downloading", "percent": 50}`