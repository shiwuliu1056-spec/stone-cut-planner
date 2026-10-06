# 宝松工具箱

宝松工具箱是一套以**微信小程序**为主入口的工具集合：首页展示工具入口，不再通过底部栏切换工具。原有业务后端和起诉助手后端保持独立。

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
  server.js              HTTP 服务唯一入口，直接运行即启动
  src/solver.js          排版算法
  src/workbook.js        Excel/Word 导入导出
  src/gemini-ocr.js      拍照识别手写/打印尺寸
  src/tikhub.js          四个平台的视频解析
  src/transcript.js      腾讯云 ASR 语音转文字
  src/wechat-decrypt.js  视频号加密视频解密
  src/private-address.js SSRF 防护：私网地址判定
  tests/                 后端测试
claim-backend/           起诉助手独立服务（本机3101），含Word引擎与已有测试
scripts/dev.mjs          一次启动两个本地服务
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
4. 执行 `npm run dev` 启动两个后端；原有工具使用 `http://127.0.0.1:3100`，起诉助手使用 `http://127.0.0.1:3101`。
5. 真机不用改配置：`app.js` 按运行平台自动切换——开发者工具走 `localApiBaseUrl`，真机走线上 `apiBaseUrl`。

> **为什么三个工具入口共用一个页面？**
> 两个工具原本是两个 `tabBar` 页面，用 `wx.switchTab` 切换。iOS 真机上每次切换时
> webview 会重新上屏，中间有 1 帧（~17ms）露出 WKWebView 的纯白画布——实测确认
> 整块内容区连同 `position: fixed` 的底栏会一起变白，页面内任何 CSS 都拦不住。
> 现在首页与三个工具总览在同页切换显隐，减少webview切换，也保留输入和解析状态。
> 导航栏标题改由 `wx.setNavigationBarTitle` 跟随切换（原本由各页 json 提供）。
> 起诉助手总览常驻主页面，资料未变化时复用填写进度；从填写页返回或回前台时会刷新。
> 只有具体填写、检查和下载会加载分包。其内“首页”返回主页面的案件总览，“返回工具箱”回到工具目录，不清空草稿或模板。旧分包总览链接兼容跳转至 `pages/index/index?tool=claim`。

### 后端部署

后端是标准 Node HTTP 服务，**不依赖任何云厂商 SDK**，同一份 `Dockerfile` 可部署到任意容器平台：

1. 用仓库根目录的 `Dockerfile` 构建镜像。容器监听 `80`（`HOST=0.0.0.0 PORT=80` 已写在镜像里）。
2. 注入下节列出的环境变量，**不要把密钥写进代码或提交到仓库**。
3. 把小程序的 `apiBaseUrl` 指向该服务的 HTTPS 域名。

> **域名是硬门槛**：`wx.request` 只能请求「已备案 + 已在小程序后台登记为 request 合法域名」的 HTTPS 域名。
> 备案与白名单没配好之前，真机一律请求失败。
>
> **冷启动**：让容器保持至少 1 个常驻副本，进程常驻即永远「热」，比按需拉起稳得多。

## 后端

### 开发运行

```bash
npm run dev
```

需要单独运行时用 `npm run dev:tools` 或 `npm run dev:claim`。已有服务占用端口时不要重复启动。两个服务分别读取根目录 `.env.local` 和 `claim-backend/.env`，未自动复制旧项目中的密钥。

原有工具默认监听 `http://127.0.0.1:3100`，可用 `PORT` 和 `HOST` 环境变量覆盖（不改变起诉助手端口）：

```bash
PORT=8080 npm run dev
```

### 生产运行

```bash
npm start
```

容器内使用 `HOST=0.0.0.0 PORT=80`。

起诉助手使用独立的 `npm run start:claim`；生产环境配置、微信身份校验和反向代理见 `claim-backend/README.md`。根目录 Dockerfile仍仅构建原有后端，没有自动发布起诉服务。

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
