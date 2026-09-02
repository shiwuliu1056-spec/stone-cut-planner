# 石材下料规划轻量微信小程序

这是现有石材下料规划工具的独立微信小程序客户端目录，不覆盖桌面版前端。

## 本地预览

1. 使用微信开发者工具打开 `miniprogram/`。
2. 当前工程已配置 AppID `wxe4560e02e4b75800`。
3. 本项目使用微信原生组件，不需要安装依赖或执行“构建 npm”。
4. 本地预览使用 `http://127.0.0.1:3000`；CloudBase 云托管部署完成后，确认 `app.js` 中的 `useCloudContainer` 为 `true`。

云托管部署包不是 `miniprogram/` 小程序包。使用仓库根目录的 `Dockerfile` 和后端部署包，服务端口填写 `80`。

## 已实现的 MVP 流程

- 首页编辑大板、小料、算法和快切偏好，草稿自动保存在本机。
- 从微信文件选择器导入 `.xlsx` 小料清单；云托管模式先上传云存储，再调用 `/api/import-url`。
- 使用相机或相册拍照；云托管模式先上传云存储，再调用 `/api/ocr/photo-url` 后在校对页逐条确认。
- 调用 `/api/solve` 生成标准或快切方案。
- 结果页按网页版排版图规则绘制 Canvas，支持逐张切换和保存 PNG 到相册。

小程序端不提供 Excel/Word 导出，也不包含桌面版的更新和退出接口。当前已预填 CloudBase 环境 ID `cloud1-d7gxlhtv344e94d8e`，云托管服务名预设为 `stone-cut-planner-api`。

## CloudBase 上线准备

1. 在 CloudBase 环境 `cloud1-d7gxlhtv344e94d8e` 中创建云托管服务 `stone-cut-planner-api`。
2. 选择本地代码部署，使用仓库根目录和 `Dockerfile.cloudbase`，服务端口填 `80`。
3. 为服务配置 `VISION_BASE_URL`、`VISION_API_KEY`、`VISION_MODEL` 环境变量。
4. 将 `app.js` 中的 `useCloudContainer` 改为 `true`，重新编译并真机测试。
5. 在微信开发者工具中执行“上传”，再到公众平台提交审核。

小程序通过 `wx.cloud.callContainer` 访问同一 CloudBase 环境的云托管服务，不需要额外 API 域名；服务必须先部署成功并与当前 AppID 关联。

正式部署后端时可使用 `HOST=0.0.0.0 PORT=3000 npm start`，或让 Nginx/Caddy 反向代理到本地服务。OCR 密钥请通过服务器环境变量 `VISION_BASE_URL`、`VISION_API_KEY`、`VISION_MODEL` 配置，不要写入小程序包或公开仓库。
