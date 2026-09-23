<!-- 文件用途：说明小程序目录结构、CloudBase 配置、开发调试和部署方式。 -->
# 宝松工具箱小程序

本目录是小程序源码，也是本项目的主要交付物。石材下料规划与视频去水印两个模块共用同一套后端服务。

## 本地预览

1. 使用微信开发者工具打开**仓库根目录**（工程入口是根目录的 `project.config.json`，`miniprogramRoot` 已指向 `miniprogram/`）。
2. 当前工程已配置 AppID `wxe4560e02e4b75800`。
3. 本项目使用微信原生组件，不需要安装依赖或执行“构建 npm”。
4. 本地预览使用 `http://127.0.0.1:3100`；CloudBase 云托管部署完成后，确认 `app.js` 中的 `useCloudContainer` 为 `true`。

云托管部署包不是 `miniprogram/` 小程序包。使用仓库根目录的 `Dockerfile`，服务端口填写 `80`。

## 已实现的 MVP 流程

- 首页编辑大板和小料，草稿自动保存在本机。
- 从微信文件选择器导入 `.xlsx` 小料清单；云托管模式先上传云存储，再调用 `/api/import-url`。
- 使用相机或相册拍照；云托管模式先上传云存储，再调用 `/api/ocr/photo-url` 后在校对页逐条确认。
- 调用 `/api/solve` 生成排版方案。
- 结果页绘制切割图 Canvas，支持逐张切换和保存 PNG 到相册。

小程序端不提供 Excel/Word 导出。当前已预填 CloudBase 环境 ID `cloud1-d7gxlhtv344e94d8e`，云托管服务名预设为 `stone-cut-planner-api`。

## CloudBase 上线准备

1. 在 CloudBase 环境 `cloud1-d7gxlhtv344e94d8e` 中创建云托管服务 `stone-cut-planner-api`。
2. 选择本地代码部署，使用仓库根目录的 `Dockerfile`，服务端口填 `80`。
3. 为服务配置 `VISION_BASE_URL`、`VISION_API_KEY`、`VISION_MODEL` 环境变量。
4. 将 `app.js` 中的 `useCloudContainer` 改为 `true`，重新编译并真机测试。
5. 在微信开发者工具中执行“上传”，再到公众平台提交审核。

小程序通过 `wx.cloud.callContainer` 访问同一 CloudBase 环境的云托管服务，不需要额外 API 域名；服务必须先部署成功并与当前 AppID 关联。

正式部署后端时可使用 `HOST=0.0.0.0 PORT=3100 npm start`，或让 Nginx/Caddy 反向代理到本地服务。OCR 密钥请通过服务器环境变量 `VISION_BASE_URL`、`VISION_API_KEY`、`VISION_MODEL` 配置，不要写入小程序包或公开仓库。

## 视频解析

- 页面由用户手动选择视频号、抖音、小红书或 TikTok，后端会校验输入与所选平台是否匹配。
- 抖音、小红书和 TikTok 可粘贴分享链接或完整分享文案。
- 四个平台都只由后端调用 TikHub 解析，不请求或抓取抖音、小红书、TikTok、微信的公开作品页面。生产环境必须配置仅服务端可见的 `TIKHUB_API_KEY`。默认使用 TikHub 面向中国大陆的官方加速域名 `https://api.tikhub.dev`；境外部署可将服务端 `TIKHUB_API_ORIGIN` 设为 `https://api.tikhub.io`，其他域名会被拒绝，避免密钥误发。
- 微信开发者工具仍连接本机 `http://127.0.0.1:3100`。运行本地后端前，请在本机 Node 进程环境中配置 `TIKHUB_API_KEY`；解析语音文案还需 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`，视频号音频提取需要 FFmpeg。密钥不要写入小程序源码或提交到 Git。配置缺失时接口会返回明确的 `503`，不会发起 TikHub 计费请求。
- 视频号支持 `weixin.qq.com/sph/` 分享短链、视频 `id` 或 `exportId`；分享短链会原样提交到 TikHub `POST /api/v1/wechat_channels/v2/fetch_video_detail` 的 `share_url`，不再先请求微信公开接口换取 `exportId`。后端使用同一次响应的 `full_url` 和 `decode_key` 即时解密 MP4。
- 第一次解析视频会返回 30 分钟有效的加密媒体令牌，随后解析文案会复用令牌中的视频地址和解密信息，不再调用 TikHub。语音文案另需配置腾讯云 ASR；媒体地址、TikHub 密钥和视频号解密密钥均不会返回为可读字段。
- 视频号文案会在后端下载并解密视频，用 FFmpeg 提取压缩语音后提交腾讯云 ASR；本地开发后端和云端均使用同一流程。
