const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

function loadHome(query = {}) {
  const source = fs.readFileSync(path.join(root, 'miniprogram/pages/index/index.js'), 'utf8');
  let definition;
  let stored = { slabs: [{ id: 'A', w: 2000, h: 1000, limit: null }], parts: [{ id: 'p', w: 500, h: 500, qty: 1 }] };
  const calls = { titles: [], vibrations: [], navigation: [], pauses: 0, toasts: [] };
  vm.runInNewContext(source, {
    Page: value => { definition = value; }, setTimeout, clearTimeout, clearInterval,
    require: name => name.includes('utils/project') ? {
      defaultProject: () => structuredClone(stored), loadProject: () => structuredClone(stored),
      saveProject: project => { stored = structuredClone(project); }, projectSummary: () => ({ totalCount: 1, totalArea: '0.250' }),
    } : name.includes('utils/errors') ? { userMessage: error => error.message } : {},
    wx: {
      setNavigationBarTitle: options => calls.titles.push(options.title), pageScrollTo() {},
      vibrateShort: options => calls.vibrations.push(options.type),
      navigateTo: options => calls.navigation.push(options), showToast: options => calls.toasts.push(options.title),
      createVideoContext: () => ({ pause: () => { calls.pauses++; } }),
    },
  }, { filename: 'miniprogram/pages/index/index.js' });
  const page = Object.assign({}, definition, { data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values); } });
  page.onLoad(query);
  return { page, calls };
}
const entry = tool => ({ detail: { tool } });

test('普通启动展示工具目录；旧工具深链接仍可进入', () => {
  for (const [query, expected] of [[{}, 'home'], [{ tool: 'cut' }, 'cut'], [{ tool: 'watermark' }, 'watermark'], [{ tool: 'claim' }, 'claim'], [{ tool: 'unknown' }, 'home']]) {
    const { page } = loadHome(query);
    assert.equal(page.data.tool, expected);
    page.onUnload();
  }
});

test('两个工具通过首页打开，资料和解析结果保留，每次有效进入只轻震动一次', async () => {
  const { page, calls } = loadHome();
  page.openTool(entry('cut')); await tick();
  const project = page.data.project;
  page.backToToolbox(); await tick();
  page.openTool(entry('watermark')); await tick();
  page.setData({ link: '测试分享链接', transcript: '测试文案', result: { title: '测试视频' }, videoUrl: 'local-video' });
  page.backToToolbox(); await tick();
  assert.equal(calls.pauses, 1);
  page.openTool(entry('cut')); await tick();
  assert.equal(page.data.project, project);
  page.backToToolbox(); await tick();
  page.openTool(entry('watermark')); await tick();
  assert.equal(page.data.link, '测试分享链接');
  assert.equal(page.data.transcript, '测试文案');
  assert.equal(page.data.result.title, '测试视频');
  assert.deepEqual(calls.vibrations, ['light', 'light', 'light', 'light']);
  assert.equal(calls.navigation.length, 0);
  page.onHide(); assert.equal(calls.pauses, 2);
  page.onUnload();
});

test('起诉总览和其他入口同页显隐，多次进入不新建页面，重复点击不叠加震动', async () => {
  const { page, calls } = loadHome();
  page.openTool(entry('claim')); page.openTool(entry('claim'));
  await tick();
  assert.equal(calls.navigation.length, 0);
  assert.equal(page.data.tool, 'claim');
  assert.deepEqual(calls.vibrations, ['light']);
  assert.equal(calls.titles.at(-1), '起诉助手');
  page.backToToolbox(); await tick();
  assert.equal(page.data.tool, 'home');
  page.openTool(entry('claim')); await tick();
  assert.equal(calls.navigation.length, 0);
  assert.equal(page.data.tool, 'claim');
  assert.deepEqual(calls.vibrations, ['light', 'light']);
  assert.equal(calls.toasts.length, 0);
  page.onUnload();
});

test('无效入口不切换；快速返回或卸载不写入过时导航标题', async () => {
  const { page, calls } = loadHome();
  page.openTool(entry('unknown')); assert.equal(page.data.tool, 'home');
  page.openTool(entry('cut')); page.backToToolbox(); await tick();
  assert.equal(calls.titles.at(-1), '宝松工具箱');
  assert.equal(calls.vibrations.length, 0);
  page.openTool(entry('watermark')); page.onUnload(); await tick();
  assert.equal(calls.titles.at(-1), '宝松工具箱');
});

test('资料页首页按钮返回主页面案件总览；直接进入资料页也有正确兜底', () => {
  let component;
  const selections = [];
  let pages = [{ route: 'pages/index/index', switchTool: (event, vibrate) => selections.push([event.currentTarget.dataset.tool, vibrate]) }, { route: 'packages/claim/pages/review/index' }, { route: 'packages/claim/pages/evidence/index' }];
  const back = [], launches = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/packages/claim/components/home-nav/index.js'), 'utf8'), {
    Component: value => { component = value; }, getCurrentPages: () => pages,
    wx: { navigateBack: options => back.push(options.delta), reLaunch: options => launches.push(options.url) },
  });
  component.methods.home(); assert.deepEqual(back, [2]); assert.equal(launches.length, 0);
  assert.deepEqual(selections, [['claim', false]]);
  pages = [{ route: 'packages/claim/pages/evidence/index' }]; component.methods.home();
  assert.deepEqual(launches, ['/pages/index/index?tool=claim']);
});

test('旧分包总览链接兼容跳回主页面起诉总览，不创建重复业务实例', () => {
  let definition;
  let returned = 0;
  let pages = [{ route: 'pages/index/index', switchTool: (event, vibrate) => { assert.equal(event.currentTarget.dataset.tool, 'claim'); assert.equal(vibrate, false); returned++; } }, { route: 'packages/claim/pages/home/index' }];
  const back = [], launches = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/packages/claim/pages/home/index.js'), 'utf8'), {
    Page: value => { definition = value; }, require: () => ({}), getCurrentPages: () => pages,
    wx: { navigateBack: options => back.push(options.delta), reLaunch: options => launches.push(options.url) },
  });
  definition.onLoad(); assert.equal(returned, 1); assert.deepEqual(back, [1]);
  pages = [{ route: 'packages/claim/pages/home/index' }]; definition.onLoad();
  assert.deepEqual(launches, ['/pages/index/index?tool=claim']);
});

test('起诉总览组件在启动时预备，重新显示和从填写页返回会刷新资料，返回仅派发事件', () => {
  let definition;
  let refreshes = 0;
  const events = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/components/claim-home/index.js'), 'utf8'), {
    Component: value => { definition = value; },
    require: () => ({ data: {}, methods: { refresh() { refreshes++; } } }),
  });
  const component = { properties: { active: false }, refresh: definition.methods.refresh, triggerEvent: event => events.push(event) };
  definition.lifetimes.attached.call(component); assert.equal(refreshes, 1);
  definition.observers.active.call(component, false); assert.equal(refreshes, 1);
  definition.observers.active.call(component, true); assert.equal(refreshes, 2);
  definition.pageLifetimes.show.call(component); assert.equal(refreshes, 2);
  component.properties.active = true; definition.pageLifetimes.show.call(component); assert.equal(refreshes, 3);
  definition.methods.backToToolbox.call(component); assert.deepEqual(events, ['back']);
  const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/index/index.wxml'), 'utf8');
  const tag = wxml.match(/<claim-home[^>]*>/)[0];
  assert.doesNotMatch(tag, /wx:if/);
  assert.match(wxml, /<view class="claim-page" hidden="\{\{tool !== 'claim'\}\}">/);
});

test('起诉总览对未变化的案件复用进度，编辑、换案件或返回前台时重新检查', () => {
  let checks = 0;
  let completion = 50;
  const current = { caseId: 'case-1', revision: 0 };
  const context = { module: { exports: {} }, require: () => ({ get: () => current, progressSummary: () => { checks++; return { completion, columns: [completion, 0, 0, 0, 0] }; } }) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/shared/claim/home.js'), 'utf8'), context);
  const overview = context.module.exports;
  let patches = 0;
  const component = { ...overview.methods, data: structuredClone(overview.data), setData(patch) { patches++; Object.assign(this.data, patch); } };
  component.refresh(); component.refresh(); component.refresh();
  assert.equal(checks, 1); assert.equal(patches, 1);
  current.revision++; component.refresh(); assert.equal(checks, 2);
  current.caseId = 'case-2'; component.refresh(); assert.equal(checks, 3);
  completion = 0; component.refresh(true); assert.equal(checks, 4); assert.equal(component.data.completion, 0);
});

test('主页面隐藏时取消延迟标题更新；从资料页返回恢复当前工具标题', async () => {
  const { page, calls } = loadHome();
  page.openTool(entry('claim')); page.onHide(); await tick();
  assert.equal(calls.titles.at(-1), '宝松工具箱');
  page.onShow(); assert.equal(calls.titles.at(-1), '起诉助手');
  page.onUnload();
});

test('目录组件三个入口均派发同一种选择事件，使用即刻按压反馈且无底部栏', () => {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/components/toolbox-home/index.js'), 'utf8'), { Component: value => { definition = value; } });
  assert.deepEqual(Array.from(definition.data.tools, tool => tool.id), ['cut', 'watermark', 'claim']);
  const events = [];
  for (const tool of definition.data.tools) {
    definition.methods.selectTool.call({ triggerEvent: (type, data) => events.push([type, data.tool]) }, { currentTarget: { dataset: { tool: tool.id } } });
    assert.ok(fs.existsSync(path.join(root, 'miniprogram', tool.image)));
  }
  assert.deepEqual(events, [['toolselect', 'cut'], ['toolselect', 'watermark'], ['toolselect', 'claim']]);
  const home = fs.readFileSync(path.join(root, 'miniprogram/components/toolbox-home/index.wxml'), 'utf8');
  assert.match(home, /hover-start-time="0"/); assert.match(home, /拥抱AI/);
  assert.doesNotMatch(home, /tool-category|entry-arrow/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'miniprogram/pages/index/index.wxml'), 'utf8'), /class="tab-bar"/);
});
