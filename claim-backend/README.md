# 起诉助手后端

从已验收的起诉助手项目移入，保持独立HTTP服务、现有Word引擎、案件契约和测试。不会覆盖原有工具箱后端。

## 本地

Node.js >=22。根目录执行 `npm install` 安装两个后端依赖，然后在本目录执行 `npx playwright install chromium` 准备浏览器。文书生成还需LibreOffice Writer：已有Codex随附运行时会自动使用，也可用 `CLAIM_SOFFICE_PATH` 指定可执行文件。中文字体及许可保留在 `fonts/`。

根目录 `npm run dev` 一次启动两个服务；已有3100服务时可只执行 `npm run dev:claim`。起诉服务默认监听127.0.0.1:3101，健康检查 `GET /api/claim/health`。所有业务接口前缀保持 `/api/claim`。

本地配置保存到本目录 `.env`，字段见 `.env.example`。没有自动复制来源项目的密钥。AI检查需另行配置 `DEEPSEEK_API_KEY`；无需AI密钥即可填写资料、做系统检查并生成Word。

## 生产接入（尚未部署）

配置 `NODE_ENV=production`、`ALLOW_DEV_AUTH=0`、`MINIPROGRAM_APP_ID`、`MINIPROGRAM_APP_SECRET`，以及AI服务和Writer路径。服务保持仅本机监听，由已有HTTPS域名反向代理；不公开开发身份，也不暴露渲染引擎路径。

在现有HTTPS server中增加独立路由，先检查与已有规则的优先级，不覆盖整个站点：

```nginx
location /bstools/api/claim/ {
    client_max_body_size 21m;
    proxy_read_timeout 130s;
    proxy_send_timeout 130s;
    proxy_pass http://127.0.0.1:3101/api/claim/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

微信后台需登记该HTTPS域名的request、uploadFile和downloadFile。服务器、域名和小程序发布未在本次整合中变更。

## 验证与维护

根目录 `npm test` 执行两个后端测试；`npm run test:claim` 单独测试起诉助手。集成测试使用虚构材料，检查真实Word排版、任务所有权和ZIP输出，生成物位于忽略的 `test-output/`。

保留原有客户端存储键；同AppID下不会主动清空案件、附件或模板。服务器任务有效期30分钟；身份会话1小时。模板适用范围仍为九江民事一审买卖合同纠纷，不宣称法院审核认可。

引擎字段变更后，在本目录运行 `npm run generate-client`，检查并应用输出补丁，再运行测试；该命令自身不会修改小程序字段文件。
