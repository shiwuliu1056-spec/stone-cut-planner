const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, 'miniprogram', file), 'utf8');

function harness() {
  let definition, navigation;
  const pages = [], calls = { vibrations: [], urls: [], pauses: 0, titles: [], redirects: [] };
  let stored = { slabs: [{ id:'A', w:2000, h:1000, limit:null }], parts:[{id:'p',w:500,h:500,qty:1}] };
  let failNext = false;
  const wx = {
    setNavigationBarTitle: o => calls.titles.push(o.title),
    vibrateShort: o => calls.vibrations.push(o.type), showToast() {},
    createVideoContext: () => ({pause() { calls.pauses++; }}),
    navigateTo(o) {
      calls.urls.push(o.url);
      if (failNext) { failNext=false; o.fail(); return; }
      const previous=pages.at(-1); if(previous.onHide) previous.onHide();
      create({tool:o.url.split('?tool=')[1]}); if(o.success)o.success();
    },
    navigateBack(o) { for(let i=0;i<o.delta;i++){const p=pages.pop();if(p.onUnload)p.onUnload();}const p=pages.at(-1);if(p.onShow)p.onShow(); },
    reLaunch(o) { while(pages.length){const p=pages.pop();if(p.onUnload)p.onUnload();}create({tool:o.url.split('?tool=')[1]}); },
    redirectTo(o) { calls.redirects.push(o.url); pages.pop(); create({tool:o.url.split('?tool=')[1]}); },
  };
  const navContext = {module:{exports:{}},wx,getCurrentPages:()=>pages};
  vm.runInNewContext(read('shared/tool-navigation.js'),navContext); navigation=navContext.module.exports;
  vm.runInNewContext(read('pages/index/index.js'), {
    Page:d=>definition=d, getCurrentPages:()=>pages, wx, setTimeout,clearTimeout,clearInterval,
    require: name => name.includes('tool-navigation') ? navigation : name.includes('utils/project') ? {
      defaultProject:()=>structuredClone(stored),loadProject:()=>structuredClone(stored),
      saveProject:p=>{stored=structuredClone(p);return p;},projectSummary:()=>({totalCount:1,totalArea:'0.250'}),
    } : name.includes('utils/errors') ? {userMessage:e=>e.message} : {},
  });
  function create(query={}) {
    const p={...definition,route:'pages/index/index',data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};
    pages.push(p);p.onLoad(query);p.onShow();p.onReady();return p;
  }
  return {create,pages,calls,navigation,wx,failNext:()=>{failNext=true;}};
}
const enter=(p,tool)=>p.openTool({detail:{tool}});

test('三个工具分别压入原生页面栈，系统返回目的地是未改变的目录',()=>{
  const h=harness(),home=h.create();
  for(const tool of ['cut','watermark','claim']) {
    enter(home,tool);assert.equal(h.pages.length,2);assert.equal(h.pages[0],home);
    assert.equal(home.data.tool,'home');assert.equal(h.pages[1].data.tool,tool);
    // 模拟宿主侧滑完成后的原生出栈，而不是模拟业务触摸回调。
    h.wx.navigateBack({delta:1});assert.equal(h.pages.length,1);assert.equal(h.pages[0].data.tool,'home');
  }
  assert.deepEqual(h.calls.vibrations,['light','light','light']);
});
test('顶部折返箭头使用原生出栈，多层工具也回到真正目录',()=>{
  const h=harness(),home=h.create();enter(home,'cut');
  const cut=h.pages.at(-1);h.pages.push({route:'other',data:{}});
  cut.backToToolbox();assert.equal(h.pages.length,1);assert.equal(h.pages[0],home);
});
test('分享或旧链接直接启动三个工具也保留底层目录，无额外震动',()=>{
  for(const tool of ['cut','watermark','claim']){
    const h=harness();h.create({tool});
    assert.equal(h.pages.length,2);assert.equal(h.pages[0].data.tool,'home');assert.equal(h.pages[1].data.tool,tool);
    assert.equal(h.calls.vibrations.length,0);
  }
});
test('快速重复点击不叠加页面，返回后可再次进入；失败后可重试',()=>{
  const h=harness(),home=h.create();enter(home,'cut');enter(home,'cut');assert.equal(h.pages.length,2);
  h.wx.navigateBack({delta:1});enter(home,'claim');assert.equal(h.pages.length,2);
  h.wx.navigateBack({delta:1});h.failNext();enter(home,'watermark');assert.equal(h.pages.length,1);
  enter(home,'watermark');assert.equal(h.pages.length,2);
  const count=h.calls.urls.length;enter(home,'unknown');assert.equal(h.calls.urls.length,count);
});
test('视频输入与结果跨出栈保留，忙碌和进度状态不带入新页面',()=>{
  const h=harness(),home=h.create();enter(home,'watermark');
  h.pages.at(-1).setData({link:'测试链接',transcript:'测试文案',result:{title:'视频'},videoUrl:'local-video',parsing:true,videoProgressTask:'parse'});
  h.wx.navigateBack({delta:1});enter(home,'watermark');const data=h.pages.at(-1).data;
  assert.equal(data.link,'测试链接');assert.equal(data.transcript,'测试文案');assert.equal(data.result.title,'视频');
  assert.equal(data.parsing,false);assert.equal(data.videoProgressTask,'');assert.ok(h.calls.pauses>=1);
});
test('石材尺寸从原草稿恢复，导航不清空资料',()=>{
  const h=harness(),home=h.create();enter(home,'cut');
  h.pages.at(-1).persist({slabs:[{id:'A',w:2600,h:1800,limit:null}],parts:[]});
  h.wx.navigateBack({delta:1});enter(home,'cut');assert.equal(h.pages.at(-1).data.project.slabs[0].w,2600);
});
test('资料页和旧入口优先返回上层起诉总览，不误选底层目录',()=>{
  const h=harness(),home=h.create();enter(home,'claim');const claim=h.pages.at(-1);
  h.pages.push({route:'packages/claim/pages/complaint/index',data:{}});
  h.pages.push({route:'packages/claim/pages/evidence/index',data:{}});
  h.navigation.returnToClaim();assert.equal(h.pages.length,2);assert.equal(h.pages.at(-1),claim);assert.equal(home.data.tool,'home');
  h.wx.navigateBack({delta:1});h.pages.push({route:'packages/claim/pages/home/index',data:{}});
  h.navigation.returnToClaim();assert.equal(h.pages.length,2);assert.equal(h.pages[0],home);assert.equal(h.pages[1].data.tool,'claim');
  assert.deepEqual(h.calls.redirects,['/pages/index/index?tool=claim']);
});
test('无总览的深链接资料页返回时重建目录与起诉总览两层',()=>{
  const h=harness();h.pages.push({route:'packages/claim/pages/complaint/index',data:{}});
  h.navigation.returnToClaim();assert.equal(h.pages.length,2);assert.equal(h.pages[0].data.tool,'home');assert.equal(h.pages[1].data.tool,'claim');
});
test('填写资料直接navigateTo，过程中不操作目录或返回容器',()=>{
  const urls=[],context={module:{exports:{}},require:()=>({pagePath:()=>'/packages/claim/pages/complaint/index'}),wx:{navigateTo:o=>urls.push(o.url)}};
  vm.runInNewContext(read('shared/claim/home.js'),context);context.module.exports.methods.continueCase();
  assert.deepEqual(urls,['/packages/claim/pages/complaint/index']);
  assert.doesNotMatch(read('shared/claim/home.js'),/switchTool|reLaunch|navigateBack|page-container/);
});
test('正文在固定导航之外，不拦截触摸，非选中工具不创建复杂DOM',()=>{
  const wxml=read('pages/index/index.wxml');
  assert.doesNotMatch(wxml,/page-container|touchstart|touchmove|touchend|touchcancel/);
  assert.doesNotMatch(read('pages/index/index.js'),/onToolTouch|switchTool|pageScrollTo/);
  assert.match(wxml,/class="page-shell index-page" wx:if="\{\{tool === 'cut'\}\}"/);
  assert.match(wxml,/class="page-shell watermark-page" wx:if="\{\{tool === 'watermark'\}\}"/);
  assert.match(wxml,/src="\/assets\/return.svg"/);
  let depth=0,bodyDepth;
  for(const match of wxml.matchAll(/<\/?view\b(?:[^"'>]|"[^"]*"|'[^']*')*>|<toolbox-home/g)){
    if(match[0]==='<toolbox-home'){bodyDepth=depth;continue;}
    depth+=match[0].startsWith('</')?-1:match[0].endsWith('/>')?0:1;assert.ok(depth>=0);
  }
  assert.equal(bodyDepth,1);assert.equal(depth,0);
  assert.match(read('pages/index/index.wxss'),/\.tool-nav\s*\{[^}]*position:fixed;/);
});
test('旧分包入口及资料页首页按钮都委托原生导航辅助函数',()=>{
  for(const file of ['packages/claim/pages/home/index.js','packages/claim/components/home-nav/index.js']) {
    assert.match(read(file),/navigation.returnToClaim\(\)/);assert.doesNotMatch(read(file),/switchTool|findIndex/);
  }
});
test('未变化的起诉资料复用进度检查，回前台仍刷新',()=>{
  let checks=0;const current={caseId:'case-1',revision:0};
  const context={module:{exports:{}},require:()=>({get:()=>current,progressSummary:()=>{checks++;return {completion:50,columns:[50,0,0,0,0]};}})};
  vm.runInNewContext(read('shared/claim/home.js'),context);const def=context.module.exports;
  const c={...def.methods,data:structuredClone(def.data),setData(p){Object.assign(this.data,p);}};
  c.refresh();c.refresh();assert.equal(checks,1);current.revision++;c.refresh();assert.equal(checks,2);
});
