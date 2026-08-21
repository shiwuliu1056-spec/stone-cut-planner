# 整体代码精简建议检查报告

检查范围：[`frontend/`](../frontend/)、[`backend/`](../backend/)、[`shared/API.md`](API.md)、根配置 [`package.json`](../package.json)。本次目标不是报告功能缺陷，而是在不篡改现有界面功能、不修改接口契约的前提下，评估可精简方向。

检查结论：当前功能基线通过，但项目仍有较多可精简空间。建议优先做低风险删除和收口，再考虑算法与导出模块拆分。未发现必须立即修复的 P0/P1 阻断问题；以下为按风险和收益排序的精简建议。

## P2

### P2-1 移除前端脚手架残留与未使用静态资源

- 位置：模板 README [`frontend/README.md`](../frontend/README.md:1)，默认 metadata [`frontend/src/app/layout.js`](../frontend/src/app/layout.js:14)，默认图标资源目录 [`frontend/public/`](../frontend/public/)，默认全局变量与暗色偏好样式 [`frontend/src/app/globals.css`](../frontend/src/app/globals.css:3)。
- 原因：当前业务首页在 [`frontend/src/app/page.js`](../frontend/src/app/page.js:6) 已完整自定义，未引用 `file.svg`、`globe.svg`、`next.svg`、`vercel.svg`、`window.svg` 等脚手架资源；[`frontend/README.md`](../frontend/README.md:1) 仍是 `create-next-app` 默认文档；[`metadata`](../frontend/src/app/layout.js:14) 仍显示 `Create Next App`。这些内容不会改变界面功能，但会增加维护噪音。
- 精简建议：删除未引用的默认 SVG，改写或删除模板 README；把 metadata 改为业务名称；[`globals.css`](../frontend/src/app/globals.css:3) 可只保留 Tailwind 导入、实际字体变量和必要 body 样式。该项风险低，适合第一批处理。

### P2-2 更新模块体积较大，但当前页面只展示按钮，没有前端调用链

- 位置：页脚按钮 [`frontend/src/app/page.js`](../frontend/src/app/page.js:39) 和 [`frontend/src/app/page.js`](../frontend/src/app/page.js:41)，后端更新模块 [`backend/src/updater.js`](../backend/src/updater.js:1)，更新路由注册 [`backend/server.js`](../backend/server.js:198)。
- 原因：后端已实现在线更新检查、下载、校验和进度接口，但前端页脚按钮目前没有绑定 `onClick`，实际界面功能只是展示按钮文本。若当前交付目标不包含在线更新能力，保留 [`backend/src/updater.js`](../backend/src/updater.js:1) 会带来额外网络、文件系统、打包环境和测试维护成本。
- 精简建议：二选一处理。若用户仍需要保留“检查更新”这项界面承诺，应补齐最小调用链，不建议删除；若只是本地离线工具且不需要更新功能，可删除更新模块、更新路由和 [`backend/tests/updater.test.js`](../backend/tests/updater.test.js:1)，同时把页脚按钮改为无歧义的静态状态或移除按钮。注意：删除接口会改变 [`shared/API.md`](API.md:151) 中可选系统接口，若不允许改接口契约，则只能保留路由但可把实现收缩为固定返回 `configured:false` 的极简版本。

### P2-3 导出前完整性校验在 Excel 与 Word 共享，但文件过大且职责混在同一模块

- 位置：Excel/Word/导入同在 [`backend/src/workbook.js`](../backend/src/workbook.js:1)，Excel 构建 [`backend/src/workbook.js`](../backend/src/workbook.js:421)，Word 构建 [`backend/src/workbook.js`](../backend/src/workbook.js:647)，共享校验 [`backend/src/workbook.js`](../backend/src/workbook.js:469) 和 [`backend/src/workbook.js`](../backend/src/workbook.js:507)。
- 原因：[`backend/src/workbook.js`](../backend/src/workbook.js:1) 同时承担 Excel 导入、Excel 导出、Word 导出、图片校验、结果结构校验和几何完整性校验，单文件超过 700 行。它不是功能缺陷，但后续维护成本高，任何导入导出小改动都需要在大文件里定位。
- 精简建议：不改变接口时，可以把校验函数集中为一个内部 helper，Excel 与 Word 只调用一次统一入口；如果允许文件重组，可拆成 `import.js`、`export-excel.js`、`export-word.js`、`result-validation.js`。如果目标是“代码行数最少”，比拆文件更有效的是保留强校验但删除重复注释和兼容层，尤其是只接受当前前端发送的 `{ result, images }` 形态时，可收缩 [`resolveResult()`](../backend/src/workbook.js:406) 的兼容逻辑。

### P2-4 求解算法注释和测试命名保留大量阶段性说明，可压缩但不建议先动算法逻辑

- 位置：算法规则说明 [`backend/src/solver.js`](../backend/src/solver.js:3)，算法搜索预算 [`backend/src/solver.js`](../backend/src/solver.js:35)，测试说明 [`backend/tests/solver.test.js`](../backend/tests/solver.test.js:3)。
- 原因：[`backend/src/solver.js`](../backend/src/solver.js:1) 是核心业务价值所在，算法实现本身较紧密；真正可精简的是长段规则注释、阶段性缺陷编号、测试标题里的历史 P 编号。直接压缩算法函数可能带来排版结果变化，风险高于收益。
- 精简建议：保留行为测试，先删除或压缩阶段性注释、历史缺陷编号和已过期说明。算法内部只建议做局部命名和重复邻接判断提取，不建议为追求行数重写搜索策略。

## P3

### P3-1 前端状态与表格更新逻辑可合并小函数

- 位置：状态更新 [`frontend/src/store/index.js`](../frontend/src/store/index.js:77)，大板更新 [`frontend/src/store/index.js`](../frontend/src/store/index.js:96)，小料更新 [`frontend/src/store/index.js`](../frontend/src/store/index.js:123)，导入后设置小料 [`frontend/src/store/index.js`](../frontend/src/store/index.js:151)。
- 原因：多个 action 都重复执行“复制数组、更新、重算编号、保存本地草稿、返回状态”。这不是问题，但可读性和行数都可以进一步收缩。
- 精简建议：增加一个小的 `persistPatch` 或 `updateCollection` helper，统一本地保存和数组更新。注意不要改变小料按面积重编号的行为，否则会改变界面编号结果。

### P3-2 前端下载和接口错误处理可抽为小函数

- 位置：排版请求 [`frontend/src/components/ActionConsole.js`](../frontend/src/components/ActionConsole.js:30)，Excel 下载 [`frontend/src/components/ActionConsole.js`](../frontend/src/components/ActionConsole.js:78)，Word 下载 [`frontend/src/components/ActionConsole.js`](../frontend/src/components/ActionConsole.js:93)，导入请求 [`frontend/src/components/PartsPanel.js`](../frontend/src/components/PartsPanel.js:32)。
- 原因：多个 `fetch` 路径重复处理 JSON、Blob、错误提示和下载链接创建。抽成 `requestJson`、`downloadBlob` 不会改变 UI，但能减少重复代码。
- 精简建议：只抽纯工具函数，不改变按钮布局和弹窗文案；保留当前同时导出 Excel + Word 的顺序和文件名。

### P3-3 UI 基础组件来自通用组件模板，可按实际使用裁剪 variant 与 size

- 位置：按钮变体 [`frontend/src/components/ui/Button.js`](../frontend/src/components/ui/Button.js:4)，输入组件 [`frontend/src/components/ui/Input.js`](../frontend/src/components/ui/Input.js:4)，表格组件 [`frontend/src/components/ui/Table.js`](../frontend/src/components/ui/Table.js:5)，工具函数 [`frontend/src/lib/utils.js`](../frontend/src/lib/utils.js:4)。
- 原因：当前 UI 组件保留了通用模板风格，例如 [`variant="danger"`](../frontend/src/components/ui/Button.js:15)、[`size="sm"`](../frontend/src/components/ui/Button.js:17) 等目前未见业务引用；[`clsx`](../frontend/package.json:12) 和 [`tailwind-merge`](../frontend/package.json:17) 只服务于 `cn()`。
- 精简建议：若追求最少依赖和最少代码，可删除未使用的按钮变体和尺寸；进一步可不用 `cn()`，改用模板字符串或简单数组 join，从而移除 `clsx` 与 `tailwind-merge`。这会触及多个组件 className 合并方式，建议放在前端静态回归后做。

### P3-4 前后端启动模式已经合并，前端 rewrite 可重新评估

- 位置：单进程内嵌 Next [`backend/src/webapp.js`](../backend/src/webapp.js:26)，后端入口 [`backend/server.js`](../backend/server.js:273)，前端 rewrite [`frontend/next.config.mjs`](../frontend/next.config.mjs:3)。
- 原因：当前 [`backend/server.js`](../backend/server.js:289) 已把非 API 请求交给内嵌 Next，根脚本 [`package.json`](../package.json:8) 直接启动后端即可服务页面和 API。独立运行前端开发服务时，[`frontend/next.config.mjs`](../frontend/next.config.mjs:3) 的 rewrite 仍有价值；若以后只保留单进程启动，rewrite 会成为额外配置。
- 精简建议：先明确最终运行方式。若只支持根目录单进程启动，可删除 rewrite；若仍支持独立前端开发服务，则保留 rewrite，并把端口常量与根启动端口保持一致。

## 不建议删除的内容

- [`backend/src/solver.js`](../backend/src/solver.js:508) 不建议为缩短代码而重写核心搜索逻辑；它直接决定排版结果，用户已经确认功能满意。
- [`backend/src/workbook.js`](../backend/src/workbook.js:507) 的导出完整性校验不建议直接删除；它能防止生成可打开但内容自相矛盾的 Excel/Word。
- [`backend/tests/`](../backend/tests/) 不建议大幅删除。当前测试覆盖了导入、导出、接口和算法规则，是后续精简时确认“不篡改功能”的主要保护网。
- [`shared/API.md`](API.md) 不建议在本轮精简中修改。只要接口契约保持不变，前后端都能围绕同一边界收缩内部代码。

## 建议执行顺序

1. 低风险清理：删除前端脚手架文档、默认 SVG、默认 metadata 和无用全局样式。
2. 收缩前端重复逻辑：合并 store 更新 helper，抽取请求和下载 helper，裁剪未使用 Button variant。
3. 决策更新功能：保留并补齐前端调用，或在不改 API 的前提下把后端实现收缩为固定“未配置更新”。
4. 收缩导出模块：保留行为和强校验，减少兼容层、重复注释和大文件内职责混杂。
5. 最后才碰算法：只做注释压缩和重复小函数提取，不改变搜索策略和结果排序。

## Git 与运行检查

- Git status 显示旧根文件删除、当前 [`backend/`](../backend/) / [`frontend/`](../frontend/) / [`shared/`](../shared/) 多数为未跟踪文件；本次按当前工作区实际文件检查。
- 已运行 [`npm test`](../package.json:15)：后端 106 个测试通过，前端 lint 通过，前端 build 通过。
- 测试输出包含 Node 的 `ExperimentalWarning: localStorage is not available...`，不影响退出码。

## 行数估算

当前已统计的主要源码、配置和检查报告合计约 3,347 行，其中 [`frontend/src/`](../frontend/src/) 约 1,177 行、[`backend/`](../backend/) 主要源码约 1,979 行；该统计包含注释、空行、测试和本报告，不等于最终运行包体积。

- 保守精简：删除 [`frontend/public/`](../frontend/public/) 中 5 个未引用 SVG、清理 [`frontend/README.md`](../frontend/README.md)、删除模板样式和无用组件配置、压缩重复注释，预计减少约 80 至 150 行业务仓库文本，不改变任何接口或界面交互。
- 推荐精简：在保守精简基础上，合并 [`frontend/src/store/index.js`](../frontend/src/store/index.js:77) 的重复持久化更新逻辑、抽取 [`frontend/src/components/ActionConsole.js`](../frontend/src/components/ActionConsole.js:56) 的通用请求/下载逻辑、收缩 [`backend/src/workbook.js`](../backend/src/workbook.js:406) 的不再需要的结果兼容层，预计净减少约 150 至 260 行。由于会增加少量 helper，实际净减少取决于重构方式。
- 激进精简：再移除 [`backend/src/updater.js`](../backend/src/updater.js:1)、更新路由和对应测试，理论上可再减少约 300 至 380 行，但会改变 [`shared/API.md`](API.md:151) 中可选更新接口的实际行为，不符合“接口契约完全不动”的最严格要求，不建议直接采用。
- 不应计入精简目标的部分：[`backend/src/solver.js`](../backend/src/solver.js:1) 核心算法约 645 行，以及 [`backend/tests/`](../backend/tests/) 测试代码。删除这些代码虽然行数下降明显，但会直接增加排版结果回归风险，不能作为安全精简。

因此，在“界面功能不变、接口契约不变、保留测试保护”的前提下，合理目标是净减少约 150 至 260 行，约占主要项目文本的 5% 至 8%。再往上压，收益主要来自删除更新能力、导出校验或算法/测试，已经不属于单纯代码整理。
