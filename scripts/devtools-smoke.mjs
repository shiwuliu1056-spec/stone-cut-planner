// 只验证导航和布局，不填示例、不清空资料、不调用计费的解析/AI接口。
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.WECHATIDE_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide';
function call(tool, args = []) {
  const output = execFileSync(cli, ['-c', 'Codex', tool, '--project', project, ...args], { encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
  const json = JSON.parse(output.slice(output.indexOf('{')));
  assert.equal(json.ok, true, output);
  return json.result;
}
const evaluate = source => call('automation_evaluate', ['--fn-source', source]).result.result;
const method = name => call('automation_page_action', ['--action', 'callMethod', '--method', name, '--wait', '1']);
const tap = selector => call('automation_element_action', ['--action', 'tap', '--selector', selector, '--wait-for-selector', selector]);
const state = () => evaluate('function(){var p=getCurrentPages().slice(-1)[0];return {route:p.route,tool:p.data.tool};}');
const fingerprint = () => evaluate('function(){var p=getCurrentPages()[0],s=JSON.stringify([p.data.project,p.data.link,p.data.transcript,p.data.result]),hash=0;for(var i=0;i<s.length;i++)hash=(hash*31+s.charCodeAt(i))|0;return hash;}');

const current = state();
assert.equal(current.route, 'pages/index/index', '请先在原项目回到工具箱首页再运行此脚本');
method('backToToolbox');
assert.equal(state().tool, 'home');
const initial = fingerprint();
const layout = evaluate('function(){var p=getCurrentPages().slice(-1)[0],c=p.selectComponent("#toolbox-home");return new Promise(function(resolve){wx.createSelectorQuery().in(c).selectAll(".toolbox-card").boundingClientRect().exec(function(rows){resolve({cards:rows[0],height:wx.getWindowInfo().windowHeight});});});}');
assert.equal(layout.cards.length, 3);
assert.ok(layout.cards[2].bottom <= layout.height, '三个入口应在首屏完整可见');
assert.equal(evaluate('function(){var p=getCurrentPages()[0];p.claimOverviewForSmoke=p.selectComponent("#claim-home");return !!p.claimOverviewForSmoke;}'), true, '起诉总览应在启动时已挂载');
call('simulator_screenshot', ['--path', resolve(project, 'test-output/toolbox-home.jpg'), '--wait', '1']);
console.log('首页三入口与首屏尺寸通过');

for (const tool of ['cut', 'watermark']) {
  // automator的page选择器不穿透自定义组件；调用组件入口触发真实toolselect事件。
  evaluate('function(){getCurrentPages().slice(-1)[0].selectComponent("#toolbox-home").selectTool({currentTarget:{dataset:{tool:' + JSON.stringify(tool) + '}}});return true;}');
  assert.equal(state().tool, tool);
  tap((tool === 'cut' ? '.index-page' : '.watermark-page') + ' .tool-home-link');
  assert.equal(state().tool, 'home');
  assert.equal(fingerprint(), initial, '返回工具箱不得清空原有草稿或结果');
  console.log(tool + '入口与返回通过');
}
evaluate('function(){getCurrentPages().slice(-1)[0].selectComponent("#toolbox-home").selectTool({currentTarget:{dataset:{tool:"claim"}}});return true;}');
assert.equal(state().route, 'pages/index/index'); assert.equal(state().tool, 'claim');
assert.equal(evaluate('function(){var p=getCurrentPages()[0];return getCurrentPages().length===1&&p.claimOverviewForSmoke===p.selectComponent("#claim-home");}'), true, '进入起诉总览不得创建新页面或重建组件');
const progress = evaluate('function(){return getCurrentPages()[0].selectComponent("#claim-home").data.completion;}');
call('simulator_screenshot', ['--path', resolve(project, 'test-output/claim-home.jpg'), '--wait', '1']);
evaluate('function(){getCurrentPages()[0].selectComponent("#claim-home").continueCase();return true;}');
assert.equal(state().route, 'packages/claim/pages/complaint/index');
const form = evaluate('function(){var p=getCurrentPages().slice(-1)[0],c=p.selectComponent("#form");return {step:c.properties.step,fields:c.data.fields.length,title:c.data.title};}');
assert.equal(form.step, 0); assert.ok(form.fields > 0);
evaluate('function(){getCurrentPages().slice(-1)[0].selectComponent("#claim-home-nav").home();return true;}');
assert.equal(state().route, 'pages/index/index'); assert.equal(state().tool, 'claim');
assert.equal(evaluate('function(){return getCurrentPages()[0].selectComponent("#claim-home").data.completion;}'), progress);
evaluate('function(){getCurrentPages()[0].selectComponent("#claim-home").backToToolbox();return true;}');
assert.equal(state().route, 'pages/index/index'); assert.equal(state().tool, 'home');
assert.equal(fingerprint(), initial);
assert.equal(evaluate('function(){var p=getCurrentPages()[0];var same=p.claimOverviewForSmoke===p.selectComponent("#claim-home");delete p.claimOverviewForSmoke;return same;}'), true, '返回工具箱后总览组件仍应保留');
console.log('起诉总览同页切换、组件复用、首个资料页、两层返回与资料保留通过');
