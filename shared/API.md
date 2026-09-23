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

*注：`limit` 代表大板可用数量上限，`null` 或空字符串代表不限。当前排版固定按刀片宽度 4mm 计算；`overcut`、`iterations` 等旧字段仍被忽略，`minOffcut`、`sampleSide`、`stripSide` 彻底移除。*

**响应数据 (成功 - 200 OK)**:

```json
{
  "result": {
    "plans": {
      "A": {
        "stats": {
          "slabCount": 1,
          "offcutCount": 2,
          "offcutArea": 1250000,
          "kerfWasteArea": 0
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
            ],
            "kerfWasteArea": 0
          }
        ]
      }
    }
  }
}
```

*注：前端使用 `result.plans.A` 进行结果展示。`kerfWasteArea` 表示刀片宽度造成的不可回收损耗，不属于余料。返回的余料中 `reusable` 字段已被弃用（若返回固定为 `true`）。*

当某个连续切割方向的末端块只能比请求尺寸少不超过 4mm 时，成品条目会保留 `requestedW` / `requestedH`、`shortage`、`shortageAxis` 和 `terminal: true`，其中 `w` / `h` 是实际切割尺寸；中间成品不会使用此容差。

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

## 4. 视频解析

**接口**: `POST /api/video/watermark`

**请求体**:

```json
{
  "platform": "douyin",
  "url": "分享链接或分享文案"
}
```

`platform` 可选 `wechat_channels`、`douyin`、`xiaohongshu`、`tiktok`。后端先校验链接域名与所选平台，然后只向 TikHub 发起一次解析请求；不请求或抓取各平台官网公开作品页面。

TikHub 接口选择于 2026-09-14 按在线 OpenAPI V5.3.2 及在线端点信息接口核验：

| 平台 | 正式解析接口 | 方法 | 单次标价 | 可用免费额度 | 当前调用策略 |
| --- | --- | --- | ---: | --- | --- |
| 抖音 | `/api/v1/douyin/app/v3/fetch_one_video_by_share_url` | GET | $0.001 | 是 | 直接调用一次 |
| TikTok | `/api/v1/tiktok/app/v3/fetch_one_video_by_share_url` | GET | $0.001 | 是 | 直接调用一次 |
| 小红书 | `/api/v1/xiaohongshu/app_v2/get_video_note_detail` | GET | $0.01 | 否 | 直接调用一次，不先请求图文详情 |
| 视频号 | `/api/v1/wechat_channels/v2/fetch_video_detail` | POST | $0.01 | 否 | 直接调用一次，`raw=false` |

核验来源：[TikHub 在线 OpenAPI](https://api.tikhub.io/openapi.json)、[TikHub 官方文档](https://docs.tikhub.io/)；价格和免费额度能力来自官方 `GET /api/v1/tikhub/user/get_endpoint_info`。

面向中国大陆的后端默认请求 TikHub 官方加速域名 `https://api.tikhub.dev`；境外部署可通过服务端环境变量 `TIKHUB_API_ORIGIN=https://api.tikhub.io` 切换。实现只接受这两个官方 HTTPS 域名，`TIKHUB_API_KEY` 不会发送到其他主机。

这里“可用免费额度”表示 TikHub 允许用账户免费试用额度抵扣，接口本身仍有 `endpoint_cost`，不能当作零计费接口。零计费能力核验如下：

| 平台 | 零计费单视频接口 | 是否可用于用户提交作品 |
| --- | --- | --- |
| 抖音 | `/api/v1/demo/douyin/web/fetch_one_video`、`/api/v1/demo/douyin/app/fetch_one_video` | 否，只返回固定作品 `7534641277405531446` |
| TikTok | `/api/v1/demo/tiktok/app/fetch_one_video` | 否，只返回固定作品 `7319033421676653855` |
| 小红书 | 无 | 否 |
| 视频号 | 无（微信公众号文章 Demo 与本功能无关） | 否 |

因此生产调用链没有伪“免费接口”前置请求。参数错误、平台不匹配会在调用前拒绝；TikHub 鉴权失败、余额不足、限流、私密/删除作品、无可用视频地址或服务故障均直接返回对应错误，不再盲目请求第二个接口。

视频号的 `url` 可传入 `weixin.qq.com/sph/` 分享短链、纯数字视频 `id`、以 `export/` 开头的 `exportId` 或携带该参数的视频号链接。分享短链会直接放入 v2 POST 请求体的 `share_url`，不会先请求微信公开接口换取临时 `exportId`；`object_id`、`export_id`、`share_url` 三者只提交一个。无效 ID、错误平台域名或非 HTTPS 视频号链接在调用 TikHub 前返回 `400`。

**成功响应**:

```json
{
  "durationMs": 12000,
  "downloadPath": "/api/video/download.mp4?token=...",
  "mediaToken": "...",
  "platform": "douyin",
  "platformLabel": "抖音"
}
```

`GET /api/video/download.mp4?token=...` 通过有效期令牌代理视频流；视频号媒体会在后端解密后再输出。`mediaToken` 是 30 分钟有效的 AES-256-GCM 加密解析令牌，不包含可读的上游地址或视频号解密密钥。

`POST /api/video/transcript` 接受相同的 `platform`、`url`，并可选传入第一次解析返回的 `mediaToken`：

```json
{
  "platform": "wechat_channels",
  "url": "视频 ID 或 exportId",
  "mediaToken": "..."
}
```

令牌有效且平台匹配时，后端直接复用其中的视频地址与解密信息，不再调用 TikHub；令牌无效、过期或平台不匹配时返回 403，不会自动重新解析并产生费用。未传令牌时只调用一次当前平台的 TikHub 正式接口，并在响应中补发可复用的 `mediaToken`。视频号会在后端下载并解密视频，用 FFmpeg 提取为小于 5MB 的语音文件，再以内嵌音频数据创建腾讯云录音文件识别任务。

视频接口常见错误状态：

- `400`：输入无效、平台不匹配、私密或删除作品，或 TikHub 明确把作品标记为图文且未返回视频文件。
- `403`：调用方不是目标小程序，或媒体/转写令牌无效、过期、平台不匹配。
- `429`：本地防滥用限流或 TikHub/ASR 限流。
- `502`：TikHub、媒体下载或 ASR 临时服务故障/响应格式异常；TikHub 返回了作品或笔记数据但后端未识别到视频媒体字段/HTTPS 地址时也按媒体结构问题返回 502，不称用户链接“不可下载”。
- `503`：TikHub/ASR 未配置、鉴权失败或 TikHub 余额不足。

---
