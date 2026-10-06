<!-- 文件用途：说明小程序目录结构、后端配置、开发调试和部署方式。 -->
# 宝松工具箱小程序

本目录是小程序源码，也是本项目的主要交付物。首页提供石材下料、视频去水印、起诉助手三个入口，没有底部工具切换栏。三个工具总览均同页切换、保留状态，起诉助手的详细操作和后端保持独立。

## 本地预览

1. 使用微信开发者工具打开**仓库根目录**（工程入口是根目录的 `project.config.json`，`miniprogramRoot` 已指向 `miniprogram/`）。
2. 当前工程已配置 AppID `wxe4560e02e4b75800`。
3. 本项目使用微信原生组件，不需要安装依赖或执行“构建 npm”。
4. 本地预览使用 `http://127.0.0.1:3100`：`app.js` 按运行平台自动切换地址，开发者工具走 `localApiBaseUrl`，真机走线上 `apiBaseUrl`，不需要手动改配置。
5. 起诉助手配置位于 `shared/claim/config.js`，开发者工具使用本机3101，手机使用同一HTTPS根地址。其后端在仓库 `claim-backend/`；`npm run dev` 同时启动两个服务。

后端部署包不是 `miniprogram/` 小程序包。使用仓库根目录的 `Dockerfile`。

## 已实现的 MVP 流程

- 首页选择工具；进入石材下料后编辑大板和小料，草稿自动保存在本机。
- 从微信文件选择器导入 `.xlsx` 小料清单：读取二进制后直接 `POST /api/import`。
- 使用相机或相册拍照：压缩后以 base64 提交 `POST /api/ocr/photo`，再在校对页逐条确认。
- 调用 `/api/solve` 生成排版方案。
- 结果页绘制切割图 Canvas，支持逐张切换和保存 PNG 到相册。

石材下料不提供Excel/Word导出；起诉助手生成Word和ZIP。**已完全脱离云开发**：不使用 `wx.cloud`，既没有 `callContainer` 也没有云存储。

## 起诉助手

- 总览为常驻主页面的 `components/claim-home/`，保留五项案件资料、检查下载、配置模板和使用示例；具体操作才打开分包。
- 原 `packages/claim/pages/home/index` 链接保持兼容，但只跳转到主页面的起诉总览，不创建重复实例。
- 资料页的首页图标返回案件总览；总览的“返回工具箱”保留主页面实例，回到入口目录。
- 保留原有案件、附件和模板存储键，不迁移、不清空本机数据。
- 总览组件使用隔离样式，分包页面单独导入 `packages/claim/claim.wxss`，不把样式混入其他工具。
- 普通进出总览时按案件编号和编辑版本复用进度，避免反复读取附件；从资料页返回或小程序回前台时重新检查。
- 生产端需另行部署 `/bstools/api/claim/` 服务，并登记request/uploadFile/downloadFile合法域名。本次源码整合不等于线上发布。

## 后端上线准备

1. 用仓库根目录的 `Dockerfile` 构建镜像并部署到任意容器平台，容器监听 `80`。
2. 为服务配置 `VISION_BASE_URL`、`VISION_API_KEY`、`VISION_MODEL`、`TIKHUB_API_KEY`、`TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY` 等环境变量。
3. 把 `app.js` 的 `apiBaseUrl` 指向该服务的 HTTPS 域名。
4. 在**微信公众平台 → 开发管理 → 服务器域名**里，把该域名加入 **request 合法域名**。
5. 在微信开发者工具中执行“上传”，再到公众平台提交审核。

> **域名是硬门槛**：必须是已备案的 HTTPS 域名，且已登记为 request 合法域名。两者缺一，真机请求一律失败（`wx.cloud.callContainer` 走微信内部链路，所以以前不需要配）。
>
> **冷启动**：让容器保持至少 1 个常驻副本，进程常驻即永远“热”。

正式部署可让 Nginx/Caddy 反向代理到本地服务。密钥请通过服务器环境变量注入，不要写入小程序包或公开仓库。

## 视频解析

- 页面由用户手动选择视频号、抖音、小红书或 TikTok，后端会校验输入与所选平台是否匹配。
- 抖音、小红书和 TikTok 可粘贴分享链接或完整分享文案。
- 四个平台都只由后端调用 TikHub 解析，不请求或抓取抖音、小红书、TikTok、微信的公开作品页面。生产环境必须配置仅服务端可见的 `TIKHUB_API_KEY`。默认使用 TikHub 面向中国大陆的官方加速域名 `https://api.tikhub.dev`；境外部署可将服务端 `TIKHUB_API_ORIGIN` 设为 `https://api.tikhub.io`，其他域名会被拒绝，避免密钥误发。
- 微信开发者工具仍连接本机 `http://127.0.0.1:3100`。运行本地后端前，请在本机 Node 进程环境中配置 `TIKHUB_API_KEY`；解析语音文案还需 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`，视频号音频提取需要 FFmpeg。密钥不要写入小程序源码或提交到 Git。配置缺失时接口会返回明确的 `503`，不会发起 TikHub 计费请求。
- 视频号支持 `weixin.qq.com/sph/` 分享短链、视频 `id` 或 `exportId`；分享短链会原样提交到 TikHub `POST /api/v1/wechat_channels/v2/fetch_video_detail` 的 `share_url`，不再先请求微信公开接口换取 `exportId`。后端使用同一次响应的 `full_url` 和 `decode_key` 即时解密 MP4。
- 第一次解析视频会返回 30 分钟有效的加密媒体令牌，随后解析文案会复用令牌中的视频地址和解密信息，不再调用 TikHub。语音文案另需配置腾讯云 ASR；媒体地址、TikHub 密钥和视频号解密密钥均不会返回为可读字段。
- 视频号文案会在后端下载并解密视频，用 FFmpeg 提取压缩语音后提交腾讯云 ASR；本地开发后端和云端均使用同一流程。
