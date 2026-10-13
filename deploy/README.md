# 自建服务器部署

2026-10-12：工具箱后端部署到 `https://cacci.cn/bstools`，服务器为 `123.206.227.110`。小程序源码仍在原项目；本次没有上传或发布小程序。

- 唯一常驻服务：`bstools.service`，以专用用户 `bstools` 运行。
- 唯一监听：`127.0.0.1:3200`，三个工具共用微信会话 `/api/session`。
- 当前代码：`/opt/bstools/current`，指向 `/opt/bstools/releases/20261012-2248`。
- 私有Node：`/opt/bstools/runtime/node22`；全局Node 20未替换。
- 环境文件：`/opt/bstools/shared/toolbox.env`，所有者 `bstools`，权限600，不提交Git。
- Chromium：`/opt/bstools/shared/playwright`；文书使用 `/usr/bin/soffice` 和项目附带的中文字体。

健康检查为 `/bstools/api/health` 和 `/bstools/api/claim/health`。生产业务要求Bearer微信会话，客户端伪造的云托管身份头无效；`/engine/` 不对外开放。Nginx新增HTTPS监听，仅服务工具箱；既有HTTP配置只加入工具箱重定向include，朋友的应用、上游及白名单未更改。

原HTTP配置备份在 `/opt/bstools/shared/backups/default.before-bstools-20261012.conf`。未来更新先检查实际配置和差异，不直接覆盖朋友可能新增的配置。

工具箱访问日志单独保存到 `/var/log/nginx/bstools-access.log`，只记录路径，不记录query参数、请求体或身份令牌。

证书由Certbot管理，已完成续期演练；续期成功后使用 `/etc/letsencrypt/renewal-hooks/deploy/bstools-reload` 检查并平滑重载Nginx。

维护时仅操作工具箱服务：

```sh
sudo systemctl status bstools.service
sudo journalctl -u bstools.service -n 50 --no-pager
sudo systemctl restart bstools.service
```

验证脚本：`deploy/smoke-word.mjs` 只在本机非生产模式使用虚构材料，不调用付费接口；`scripts/verify-production.mjs` 在已授权的微信开发者工具内验证正式登录、排版、上传、生成和下载，并删除自己创建的测试任务。后者以分段取回状态避免单次automator超时。

正式发布前，确认微信后台的request、uploadFile、downloadFile域名包含 `https://cacci.cn`，不填写 `/bstools` 路径。需要上传新版小程序以使用统一登录。聊天中曾发送过的AppSecret建议由账号所有者重置，并同步更新私有环境文件；不要在聊天、源码或日志中发送新值。
