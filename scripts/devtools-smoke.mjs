// 原生导航冒烟，只读现有草稿，不调用计费接口。
// 触发导航与采集结果分开，耗时在小程序内记录，排除CLI往返。
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const cli=process.env.WECHATIDE_CLI||'/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide';
function call(tool,args=[]){
  const raw=execFileSync(cli,['-c','Codex',tool,'--project',project,...args],{encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
  const json=JSON.parse(raw.slice(raw.indexOf('{')));assert.equal(json.ok,true,raw);return json.result;
}
const evaluate=fn=>call('automation_evaluate',['--fn-source',fn]).result.result;
const state=()=>evaluate('function(){return getCurrentPages().map(p=>({route:p.route,tool:p.data.tool}));}');
function verify(predicate,label){let value;for(let i=0;i<3;i++){value=state();if(predicate(value))return value;}assert.fail(label+': '+JSON.stringify(value));}
assert.deepEqual(state(),[{route:'pages/index/index',tool:'home'}],'请先回到工具箱目录');
const measurements=[];
for(const tool of ['cut','watermark','claim']){
  evaluate(`function(){
    var home=getCurrentPages()[0],tool=${JSON.stringify(tool)},start=Date.now();home.smokeEntry={tool:tool};
    home.selectComponent('#toolbox-home').selectTool({currentTarget:{dataset:{tool:tool}}});
    function measure(){
      if(Date.now()-start>8000){home.smokeEntry.error='渲染等待超时';return;}
      var pages=getCurrentPages(),p=pages[1];
      if(!p||p.data.tool!==tool){setTimeout(measure,20);return;}
      wx.createSelectorQuery().in(p).select(tool==='claim'?'.claim-page':'.page-shell').boundingClientRect().exec(function(rows){
        if(rows[0]&&rows[0].height>0)home.smokeEntry.renderMs=Date.now()-start;else setTimeout(measure,20);
      });
    }measure();return true;
  }`);
  verify(s=>s.length===2&&s[0].tool==='home'&&s[1].tool===tool,tool+'原生页面栈');
  const metric=evaluate('function(){return getCurrentPages()[0].smokeEntry;}');
  assert.ok(Number.isFinite(metric.renderMs),JSON.stringify(metric));measurements.push(metric);
  if(tool==='cut'){
    call('automation_viewport_action',['--action','pageScrollTo','--scroll-top','500']);
    const layout=evaluate('function(){var p=getCurrentPages()[1];return new Promise(r=>wx.createSelectorQuery().in(p).select(".page-shell").boundingClientRect().select(".tool-nav").boundingClientRect().exec(rows=>r(rows)));}');
    assert.ok(layout[0].top<0,'石材正文应可滚动');assert.equal(layout[1].top,0,'顶部箭头应固定');
  }
  if(tool==='claim'){
    evaluate('function(){getCurrentPages()[1].selectComponent("#claim-home").continueCase();return true;}');
    verify(s=>s.length===3&&s[0].tool==='home'&&s[1].tool==='claim'&&s[2].route==='packages/claim/pages/complaint/index','填写资料直达');
    evaluate('function(){getCurrentPages()[2].selectComponent("#claim-home-nav").home();return true;}');
    verify(s=>s.length===2&&s[1].tool==='claim','资料返回起诉总览');
  }
  // 与系统侧滑相同的原生出栈，不使用业务手势回调。
  evaluate('function(){wx.navigateBack({delta:1});return true;}');
  verify(s=>s.length===1&&s[0].tool==='home',tool+'原生返回');
}
evaluate('function(){delete getCurrentPages()[0].smokeEntry;return true;}');
console.log(JSON.stringify({measurements,checks:'原生页面栈、石材滚动、填写资料直达及两级返回均通过'},null,2));
