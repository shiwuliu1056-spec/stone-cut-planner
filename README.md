# 宝松工具箱

宝松工具箱是一套以**微信小程序**为主入口的工具集合，后端由同一个 Node.js 服务承载。

小程序包含两个功能模块：

- **石材下料规划**：维护石材大板和小料清单，自动计算矩形排版方案，在结果页绘制切割图并保存到相册。
- **视频去水印**：解析视频号、抖音、小红书、TikTok 的分享链接，下载无水印视频，并可将视频语音转成文字。

## 目录结构

```text
project.config.json      微信开发者工具工程入口（miniprogramRoot 指向 miniprogram/）
miniprogram/             小程序源码（重心）
  pages/index/           唯一主页面：同时承载下料工具与视频去水印，底部栏在页内切换
  pages/ocr-review/      拍照识别结果校对
  pages/result/          排版结果与切割图
  services/api.js        后端调用封装（本地 / CloudBase 云托管双模式）
  utils/                 排版图渲染、草稿存储、错误处理
backend/                 后端服务（小程序唯一依赖）
  server.js              HTTP 服务唯一入口，直接运行即启动
  src/solver.js          排版算法
  src/workbook.js        Excel/Word 导入导出
  src/gemini-ocr.js      拍照识别手写/打印尺寸
  src/tikhub.js          四个平台的视频解析
  src/transcript.js      腾讯云 ASR 语音转文字
  src/wechat-decrypt.js  视频号加密视频解密
  tests/                 后端测试
shared/API.md            前后端接口契约
Dockerfile               容器镜像（CloudBase 云托管 / 任意容器平台）
cloudbaserc.json         CloudBase 环境与云托管服务名
```

## 环境要求

- Node.js 20.9 或更高版本（后端）
- 微信开发者工具（小程序）
- FFmpeg（仅视频号语音转文字需要，容器镜像已内置）

## 安装

在项目根目录执行，只会安装后端依赖：

```bash
npm install
```

## 小程序

### 本地预览

1. 用微信开发者工具**打开仓库根目录**（工程入口是根目录的 `project.config.json`，`miniprogramRoot` 已指向 `miniprogram/`，不需要单独打开 `miniprogram/`）。
2. 当前工程已配置 AppID `wxe4560e02e4b75800`。
3. 小程序使用微信原生组件，不需要安装依赖或执行「构建 npm」。
4. 启动本地后端后即可调试，默认地址 `http://127.0.0.1:3100`。
5. 真机预览前，把 `miniprogram/app.js` 中的 `useCloudContainer` 改为 `true`。

> **为什么只有一个 tab 页？**
> 两个工具原本是两个 `tabBar` 页面，用 `wx.switchTab` 切换。iOS 真机上每次切换时
> webview 会重新上屏，中间有 1 帧（~17ms）露出 WKWebView 的纯白画布——实测确认
> 整块内容区连同 `position: fixed` 的底栏会一起变白，页面内任何 CSS 都拦不住。
> 现在改为单页 + `hidden` 切换显隐：不换 webview，白帧在物理上不可能出现。
> 导航栏标题改由 `wx.setNavigationBarTitle` 跟随切换（原本由各页 json 提供）。

### 云托管部署

1. 在 CloudBase 环境 `cloud1-d7gxlhtv344e94d8e` 中创建云托管服务 `stone-cut-planner-api`。
2. 选择本地代码部署，使用仓库根目录的 `Dockerfile`，服务端口填 `80`。
3. 为服务配置运行环境变量（见下节），**不要把密钥写进代码或提交到仓库**。
4. 部署成功后小程序通过 `wx.cloud.callContainer` 访问，无需额外配置 API 域名。

## 后端

### 开发运行

```bash
npm run dev
```

默认监听 `http://127.0.0.1:3100`，可用 `PORT` 和 `HOST` 环境变量覆盖：

```bash
PORT=8080 npm run dev
```

### 生产运行

```bash
npm start
```

容器内使用 `HOST=0.0.0.0 PORT=80`。

### 环境变量

| 变量 | 用途 |
| --- | --- |
| `HOST` / `PORT` | 监听地址与端口 |
| `VISION_BASE_URL` / `VISION_API_KEY` / `VISION_MODEL` | 拍照识别所用的视觉模型服务 |
| `TIKHUB_API_KEY` | 视频解析，缺失时相关接口返回 503 |
| `TIKHUB_API_ORIGIN` | 可选，境外部署可设为 `https://api.tikhub.io` |
| `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY` | 语音转文字（腾讯云 ASR） |

本地开发可把上述变量写入 `.env.local`（`npm run dev` 会自动读取），或写入 `vision-config.json` 供视觉识别使用。两者都已被 Git 忽略。

## API

接口完整说明见 [`shared/API.md`](shared/API.md)。主要接口：

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查，云托管冷启动预热 |
| `POST /api/import-url` | 按云存储地址导入 Excel 小料清单 |
| `POST /api/ocr/photo-url` | 按云存储地址识别照片中的尺寸记录 |
| `POST /api/solve` | 同步计算排版方案 |
| `POST /api/solve/tasks` | 异步提交排版任务（支持 `Idempotency-Key`） |
| `GET /api/solve/tasks/:id` | 查询异步排版任务进度与结果 |
| `POST /api/video/watermark` | 解析视频链接，返回下载令牌 |
| `GET /api/video/download.mp4` | 按令牌下载无水印视频 |
| `POST /api/video/transcript` | 提交语音转文字任务 |
| `GET /api/video/transcript` | 查询转写结果 |

## Excel 导入格式

导入文件需要包含小料编号、长度、宽度和数量列。支持中文或英文表头，例如：

| 编号 | 长度 | 宽度 | 数量 |
| --- | ---: | ---: | ---: |
| A | 1400 | 600 | 13 |

尺寸和数量必须是正整数。缺少编号列时，后端会自动生成编号。

## 测试

```bash
npm test
```

使用 Node.js 内置测试运行器执行后端全部测试。

## 当前限制

- 小程序端不提供 Excel/Word 导出（后端接口保留，供其他客户端使用）。
- 排版结果是启发式搜索结果，不承诺数学意义上的全局最优。
- 所有方案固定按 4mm 刀片宽度计算，刀片损耗不计入余料。
- 视频解析依赖 TikHub，语音转文字依赖腾讯云 ASR，二者都需要自备密钥。

## 许可证

本项目使用 [MIT License](LICENSE)。
