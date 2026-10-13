# 宝松工具箱

宝松工具箱是一套以**微信小程序**为主入口的工具集合：首页展示工具入口，不再通过底部栏切换工具。三个工具共用一个Node进程、一个HTTP端口和一套微信身份校验。

小程序包含三个功能模块：

- **石材下料规划**：维护石材大板和小料清单，自动计算矩形排版方案，在结果页绘制切割图并保存到相册。
- **视频去水印**：解析视频号、抖音、小红书、TikTok 的分享链接，下载无水印视频，并可将视频语音转成文字。
- **起诉助手**：面向九江民事一审买卖合同纠纷，填写案件信息、整理附件、检查资料并生成可编辑 Word 和资料包。

## 目录结构

```text
project.config.json      微信开发者工具工程入口（miniprogramRoot 指向 miniprogram/）
miniprogram/             小程序源码（重心）
  pages/index/           工具目录与三个工具总览同页显隐，保留表单和解析结果
  components/toolbox-home/ 已确认的三列首页（编号、文字、图标）
  components/claim-home/ 常驻的起诉助手总览，不通过页面跳转打开
  packages/claim/        起诉助手详细填写、检查和下载分包
  shared/claim/          起诉助手共享模型、草稿与开发配置
  pages/ocr-review/      拍照识别结果校对
  pages/result/          排版结果与切割图
  services/api.js        后端 HTTP 调用封装、文件读取、预热与重试
  utils/                 排版图渲染、草稿存储、错误处理
backend/                 下料与视频后端
  server.js              下料与视频HTTP处理模块
  src/solver.js          排版算法
  src/workbook.js        Excel/Word 导入导出
  src/gemini-ocr.js      拍照识别手写/打印尺寸
  src/tikhub.js          四个平台的视频解析
  src/transcript.js      腾讯云 ASR 语音转文字
  src/wechat-decrypt.js  视频号加密视频解密
  src/private-address.js SSRF 防护：私网地址判定
  tests/                 后端测试
claim-backend/           起诉助手模块，含Word引擎与已有测试
scripts/server.mjs       工具箱唯一部署入口
shared/API.md            前后端接口契约
Dockerfile               容器镜像（任意容器平台）
```

## 环境要求

- Node.js 22 或更高版本（完整工具箱）；原有下料/视频后端仍支持20.9
- 微信开发者工具（小程序）
- FFmpeg（仅视频号语音转文字需要，容器镜像已内置）
- Playwright Chromium 与 LibreOffice Writer（起诉材料排版；见 `claim-backend/README.md`）

## 安装

在项目根目录执行，安装两个后端的依赖；小程序不需要构建npm：

```bash
npm install
```

## 小程序

### 本地预览

1. 用微信开发者工具**打开仓库根目录**（工程入口是根目录的 `project.config.json`，`miniprogramRoot` 已指向 `miniprogram/`，不需要单独打开 `miniprogram/`）。
2. 当前工程已配置 AppID `wxe4560e02e4b75800`。
3. 小程序使用微信原生组件，不需要安装依赖或执行「构建 npm」。
4. 执行 `npm run dev` 启动工具箱服务；三个工具均使用 `http://127.0.0.1:3100`。
5. 默认开发者工具和真机都走 `https://cacci.cn/bstools`，避免误连旧的本机服务。要本地开发时，将 `app.js` 的 `localBackendInDevtools` 改为 `true` 并运行 `npm run dev`；起诉助手的auto模式继承同一开关，手机仍走云端。

> **工具导航与状态保留**
> 目录和三个工具复用主包页面代码，通过 `navigateTo` 打开新的页面实例；页面栈是“目录 → 工具 → 资料子页”。iPhone 边缘右滑由微信原生导航处理，不拦截触摸，也不使用弹出容器。
> 顶部折返箭头固定显示；工具正文只创建当前工具的 DOM。工具入口不请求后台、不等待网络、不加载起诉分包；起诉总览代码在目录中预备。
> 石材草稿与案件资料沿用原来的本地保存，视频输入及已完成结果在内存中保留，忙碌和进度状态不跨页面恢复。
> 仅具体填写、检查和下载加载分包。其内“首页”返回已有起诉总览，不误选底层目录。直接启动 `pages/index/index?tool=claim` 等旧链接时，也先建立底层目录，再进入工具。

### 后端部署

完整工具箱以 `scripts/server.mjs` 为唯一入口。自建服务器使用Node.js 22、FFmpeg、Chromium和LibreOffice Writer，由systemd常驻运行，Nginx仅代理 `/bstools/api/` 到本机3200端口。

生产环境设置 `NODE_ENV=production`、`ALLOW_DEV_AUTH=0`、`HOST=127.0.0.1`、`PORT=3200`，把密钥放在服务器权限600的环境文件中，不提交到Git。小程序地址为 `https://cacci.cn/bstools`。

根目录旧Dockerfile仅承载原有下料与视频服务，不能用于部署完整的三个工具。

> **域名是硬门槛**：`wx.request` 只能请求「已备案 + 已在小程序后台登记为 request 合法域名」的 HTTPS 域名。
> 备案与白名单没配好之前，真机一律请求失败。
>
> **冷启动**：服务器服务常驻运行可避免按需拉起，但首次启动、进程重启和外部API延迟仍需要单独处理。

## 后端

### 开发运行

```bash
npm run dev
```

开发入口读取根目录 `.env.local` 和可选的 `claim-backend/.env`。`dev:tools`、`dev:claim`仅保留供模块诊断，不用于生产部署；已有服务占用端口时不要重复启动。

完整工具箱默认监听 `http://127.0.0.1:3100`，可用 `PORT` 和 `HOST` 覆盖：

```bash
PORT=8080 npm run dev
```

### 生产运行

```bash
npm start
```

生产运行由systemd注入环境变量并执行 `scripts/server.mjs`，仅本机监听，由Nginx提供HTTPS。健康检查、微信会话端点和签名视频下载可公开，业务接口需要Bearer会话；公网不接受客户端伪造的云托管身份头。

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
| `GET /api/health` | 健康检查，也是小程序启动时的后端预热探针 |
| `POST /api/import` | 上传 Excel 二进制导入小料清单 |
| `POST /api/ocr/photo` | 提交 base64 图片识别尺寸记录 |
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

使用 Node.js 内置测试运行器依次执行原有后端与起诉助手全部测试。首页测试覆盖导航、草稿保留、单次轻震动、视频暂停和返回路径。

微信开发者工具已登录并打开原项目、停在工具箱首页时，可运行 `node scripts/devtools-smoke.mjs`，检查三个入口、首屏尺寸、案件总览与工具箱两层返回。脚本只验证导航，不填示例、不清空资料、不调用计费接口；截图保存到忽略的 `test-output/`。CLI路径可通过 `WECHATIDE_CLI` 指定。

## 当前限制

- 石材下料工具不提供 Excel/Word 导出；起诉助手独立提供 Word 和 ZIP。
- 排版结果是启发式搜索结果，不承诺数学意义上的全局最优。
- 所有方案固定按 4mm 刀片宽度计算，刀片损耗不计入余料。
- 视频解析依赖 TikHub，语音转文字依赖腾讯云 ASR，二者都需要自备密钥。

## 许可证

本项目使用 [MIT License](LICENSE)。
