const draft = require('../../shared/draft');
const api = require('../../shared/api');
const templates = require('../../shared/templates');
const { groupIssues, groupAiIssues } = require('../../shared/review-groups');
const { resolveTarget } = require('../../shared/focus-target');
const navigation = require('../../shared/check-navigation');
const {humanHint,labels}=require('../../shared/human-hints');
function visible(field, s) {
  if (field.key === 'contractName' && s.contractForm !== '书面买卖合同') return false;
  if (field.key === 'interestTerms' && !s.claimInterest) return false;
  if (field.key === 'attorneyFeeTerms' && !s.claimAttorneyFee) return false;
  return !field.condition || ({ 'plaintiff-natural': s.plaintiffType === '个人', 'plaintiff-company': s.plaintiffType !== '个人', 'defendant-natural': s.defendantType === '个人', 'defendant-company': s.defendantType !== '个人', written: s.contractForm === '书面买卖合同', unwritten: !!s.contractForm && s.contractForm !== '书面买卖合同', agent: s.represented === 'yes', refund: s.includeRefundAccount })[field.condition];
}
Component({
  properties: { step: Number, fromReview: Boolean, checks: String, checkIndex: Number, checkTotal: Number, checkKind: String, checkLabel: String, canOptimize: Boolean, optimizationIssue: Object },
  data: { fields: [], state: {}, identityRows: [], defendantRows: [], evidenceRows: [], looseFiles: [], issues: [], issueGroups: [], aiGroups: [], busy: false, ai: null, focusKey:'', focusRowId:'', focusHint:'', optimizeBusy:false },
  lifetimes: { attached() { this.alive = true; this.aiRequested = false; this.collapsedGroups = {}; this.collapsedAiGroups = {}; this.reload(); }, detached() { this.alive = false; } },
  methods: {
    reload() {
      const current = draft.get(), s = current.state, step = this.properties.step;
      const fields = draft.schema.steps[step].fields.filter(f => visible(f, s)).map(f => {
        const value = s[f.key]; const options = f.options || []; const choice = options.findIndex(x => x.value === value);
        return Object.assign({}, f, { value, options: options.map(x => x.label), optionValues: options.map(x => x.value), choice: Math.max(0, choice), display: choice >= 0 ? options[choice].label : value || '请选择' });
      });
      const group = (row, index, key) => {
        const files = current.files.filter(f => f[key] === row.id);
        return Object.assign({}, row, { number: String(index + 1).padStart(2,'0'), files, count: files.length, types: Array.from(new Set(files.map(f => draft.fileType(f.name)))).join('、') });
      };
      const report = draft.issues();
      this.setData({issueGroups:groupIssues(report.issues,draft.schema.steps).map(group=>Object.assign({},group,{expanded:(this.collapsedGroups||{})[group.step]===false}))});
      const visibleAi=this.aiRequested&&current.ai?Object.assign({},current.ai,{issues:(current.ai.issues||[]).map((item,index)=>Object.assign({},item,{displayNumber:index+1,title:humanHint(item.title),advice:humanHint(item.advice)}))}):null;
      this.setData({aiGroups:groupAiIssues(visibleAi&&visibleAi.issues).map(group=>Object.assign({},group,{expanded:(this.collapsedAiGroups||{})[group.key]===false}))});
      if(step===5)this.setData({title:'检查下载'});
      this.setData({ template: templates[['complaint','identity','defendant','evidence','service'][step]] || null });
      this.setData({ step, title: step===5?'检查下载':draft.schema.steps[step].title, fields, state: s, identityRows: s.identityMaterials.map((row,i) => group(row,i,'materialId')), defendantRows:s.defendantMaterials.map((row,i)=>group(row,i,'materialId')), evidenceRows: s.evidence.map((row,i) => group(row,i,'evidenceId')), looseFiles: current.files.filter(f => f.group === (step === 1 ? 'agent' : 'defendant')), issues: report.issues, completion: report.completion, ai: visibleAi, grounds: draft.schema.grounds.filter(x => !x.writtenOnly || s.contractForm === '书面买卖合同').map(x => Object.assign({}, x, { checked: s.jurisdictionBases.includes(x.value) })) });
    },
    input(e) { draft.setField(e.currentTarget.dataset.key, e.detail.value); },
    change(e) { const field = this.data.fields.find(f => f.key === e.currentTarget.dataset.key); draft.setField(field.key, field.kind === 'select' ? field.optionValues[+e.detail.value] : e.detail.value); this.reload(); },
    grounds(e) { draft.setField('jurisdictionBases', e.detail.value); this.reload(); },
    addIdentity() { draft.addRow('identityMaterials'); this.reload(); wx.showToast({title:'添加成功',icon:'success'}); },
    addDefendant() { draft.addRow('defendantMaterials'); this.reload(); wx.showToast({title:'添加成功',icon:'success'}); },
    addEvidence() { wx.showActionSheet({ itemList: ['图文证据','影音证据'], success: res => { draft.addRow('evidence', res.tapIndex === 0 ? 'document' : 'media'); this.reload(); wx.showToast({title:'添加成功',icon:'success'}); } }); },
    rowInput(e) { const ds = e.currentTarget.dataset; let value = e.detail.value; if (ds.key === 'fileCount') { if (value && !/^[1-9]\d*$/.test(value)) wx.showToast({ title: '数量请填写正整数', icon: 'none' }); value = value ? Number(value) : 0; } draft.updateRow(ds.group, ds.id, ds.key, value); },
    rowChange(e) { const ds = e.currentTarget.dataset; const values = ds.key === 'mediaType' ? ['录音','视频'] : ['原件','复印件']; draft.updateRow('evidence', ds.id, ds.key, values[+e.detail.value]); this.reload(); },
    preset(e) {
      const type = draft.get().state.plaintiffType;
      const choices = type === '个人' ? ['身份证','户口簿','其他身份证明'] : type === '个体工商户' ? ['营业执照','经营者身份证','其他主体资格材料'] : ['营业执照','法定代表人身份证明','法定代表人身份证','其他主体资格材料'];
      wx.showActionSheet({ itemList: choices, success: res => { draft.updateRow('identityMaterials', e.currentTarget.dataset.id, 'name', choices[res.tapIndex]); this.reload(); } });
    },
    removeRow(e) { const ds = e.currentTarget.dataset; wx.showModal({ title: '删除这项材料？', content: '该编号下的本机文件也会移除。', success: res => { if (res.confirm) { draft.removeRow(ds.group, ds.id); this.reload(); } } }); },
    removeFile(e) { draft.removeFile(e.currentTarget.dataset.id); this.reload(); },
    chooseFiles(e) {
      const ds = e.currentTarget.dataset;
      if(ds.group==='defendant'&&!String((draft.get().state.defendantMaterials.find(row=>row.id===ds.id)||{}).name||'').trim()){wx.showToast({title:'请先填写材料名称',icon:'none'});return;}
      wx.showActionSheet({ itemList: ['从相册选择图片或拍照','从微信聊天选择文件'], success: res => {
        const done = async files => { try { const errors = await draft.addFiles(ds.group, ds.id, files); this.reload(); if (errors.length) wx.showModal({ title: '部分文件未加入', content: errors.join('\n'), showCancel: false }); } catch (err) { this.error(err); } };
        const failed = err => { if (!String(err.errMsg || '').includes('cancel')) this.error(err); };
        if (res.tapIndex === 0) wx.chooseMedia({ count: 9, mediaType: ['image'], sourceType: ['album','camera'], success: result => done(result.tempFiles.map(f => ({ path: f.tempFilePath, size: f.size }))), fail: failed });
        else wx.chooseMessageFile({ count: 9, type: 'file', success: result => done(result.tempFiles.map(f => ({ path: f.path, size: f.size, name: f.name }))), fail: failed });
      } });
    },
    async previewImage(e) { const f = draft.get().files.find(x => x.id === e.currentTarget.dataset.id); if (!f) return; if (draft.fileType(f.name) === '图片') wx.previewImage({ urls: [f.localPath] }); else wx.openDocument({ filePath: f.localPath, showMenu: true, fail: err => this.error(err) }); },
    next() { const step=this.properties.step; if(step<5)wx.redirectTo({url:draft.pagePath(step+1)}); },
    previous() { if(this.properties.step)wx.redirectTo({url:draft.pagePath(this.properties.step-1)});else wx.navigateBack(); },
    previousCheck() { this.moveCheck(-1); },
    nextCheck() { this.moveCheck(1); },
    moveCheck(delta) { const result=navigation.move(this.properties.checks,this.properties.checkIndex,delta);if(result.url)wx.redirectTo({url:result.url});else wx.showModal({title:'提示',content:result.message,showCancel:false}); },
    toggleIssueGroup(e) {
      const step=Number(e.currentTarget.dataset.step),index=this.data.issueGroups.findIndex(group=>group.step===step);
      if(index<0)return;
      const expanded=!this.data.issueGroups[index].expanded;
      if(!this.collapsedGroups)this.collapsedGroups={};this.collapsedGroups[step]=!expanded;
      this.setData({['issueGroups['+index+'].expanded']:expanded});
    },
    toggleAiGroup(e) {
      const key=e.currentTarget.dataset.key,index=this.data.aiGroups.findIndex(group=>group.key===key);
      if(index<0)return;
      const expanded=!this.data.aiGroups[index].expanded;
      if(!this.collapsedAiGroups)this.collapsedAiGroups={};this.collapsedAiGroups[key]=!expanded;
      this.setData({['aiGroups['+index+'].expanded']:expanded});
    },
    openCheck(kind,sourceIndex) {
      const items=kind==='ai'?(this.data.aiGroups||groupAiIssues(this.data.ai&&this.data.ai.issues)).reduce((all,group)=>all.concat(group.items),[]):this.data.issueGroups.reduce((all,group)=>all.concat(group.items),[]);
      const selected=items.findIndex(item=>item.sourceIndex===sourceIndex);
      if(selected>=0&&selected<items.length)wx.navigateTo({url:navigation.start(items,selected,kind)});
    },
    goIssue(e) { this.openCheck('local',Number(e.currentTarget.dataset.index)); },
    goAiIssue(e) { this.openCheck('ai',Number(e.currentTarget.dataset.index)); },
    backToReview() {
      const pages=getCurrentPages();let index=-1;
      for(let i=pages.length-2;i>=0;i--)if(pages[i].route==='packages/claim/pages/review/index'){index=i;break;}
      if(index>=0)wx.navigateBack({delta:pages.length-1-index});else wx.redirectTo({url:draft.pagePath(5)});
    },
    ensureReview() {
      if(this.properties.step!==5||this.data.busy)return;
      const current=draft.get(),key=current.caseId+':'+current.revision;
      if(current.ai){if(!this.aiRequested){this.aiRequested=true;this.reload();}return;}
      if(this.autoReviewedKey===key)return;
      this.autoReviewedKey=key;
      this.review();
    },
    async review() {
      if(this.data.busy)return;
      const current=draft.get();this.autoReviewedKey=current.caseId+':'+current.revision;
      this.aiRequested = true;
      this.setData({ busy: true });
      try { const revision = draft.get().revision, caseId=draft.get().caseId; const result = await api.call('/review','POST', { state: draft.get().state, files: draft.manifest() }); if (draft.get().revision === revision && draft.get().caseId===caseId) { draft.get().ai = result; draft.persist(false); if(this.alive)this.reload(); } }
      catch (err) { if(this.alive)this.error(err); } finally { if(this.alive){this.setData({ busy: false });this.ensureReview();} }
    },
    generate() {
      const errors = draft.issues().issues.filter(x => x.level === 'danger');
      const go = () => wx.navigateTo({ url: '/packages/claim/pages/result/index?generate=1' });
      if (errors.length) wx.showModal({ title: '还有' + errors.length + '项需要补充', content: '可以先生成草稿查看，提交前请补齐。', confirmText: '生成草稿', success: res => { if (res.confirm) go(); } }); else go();
    },
    result() { wx.navigateTo({ url: '/packages/claim/pages/case-files/index' }); },
    async optimize() {
      if(this.data.optimizeBusy||!this.properties.canOptimize)return;
      const current=draft.get(),caseId=current.caseId,revision=current.revision;
      this.setData({optimizeBusy:true});
      try{
        const result=await api.call('/optimize','POST',{state:current.state,files:draft.manifest(),issue:this.properties.optimizationIssue});
        if(!this.alive)return;
        if(draft.get().caseId!==caseId||draft.get().revision!==revision)throw Error('内容已变化，请重新检查后再优化');
        const changes=result.changes||[];
        if(!changes.length){wx.showModal({title:'需要你确认',content:humanHint(result.message||'现有资料不足以安全优化，请核对具体事实。'),showCancel:false});return;}
        wx.showModal({title:'确认优化',content:changes.map(item=>'【'+(labels[item.field]||'填写内容')+'】\n原文：'+(item.before||'未填写')+'\n优化后：'+(item.after||'清空未启用的说明')).join('\n\n').slice(0,1600),confirmText:'应用优化',success:res=>{
          if(!res.confirm)return;
          if(draft.get().caseId!==caseId||draft.get().revision!==revision){wx.showToast({title:'内容已变化，请重新优化',icon:'none'});return;}
          changes.forEach(item=>draft.setField(item.field,item.after));this.reload();wx.showToast({title:'优化已应用',icon:'success'});
        }});
      }catch(err){if(this.alive)this.error(err);}finally{if(this.alive)this.setData({optimizeBusy:false});}
    },
    focusField(key,hint,rowId) {
      if(!key&&!hint)return;
      const target=resolveTarget(key,this.properties.step,this.data.fields,this.data.state,this.data.identityRows,this.data.evidenceRows,rowId,this.data.defendantRows);
      if(!this.data.state.claimInterest&&(key==='interestTerms'||String(hint||'').includes('interestTerms')||String(hint||'').includes('计算方式'))){hint='“同时主张逾期付款损失、利息或违约金”目前未开启。如需修改“逾期付款损失、利息或违约金的计算方式”，开启本项后就会显示；未开启时该说明不会写入起诉状。';}
      this.setData({focusKey:target.key,focusRowId:target.rowId,focusHint:humanHint(hint||'请核对这一项。')},()=>{
        const scroll=()=>{if(!this.alive)return;this.createSelectorQuery().select('#'+target.domId).boundingClientRect().selectViewport().scrollOffset().exec(rects=>{
          if(!rects[0]||!rects[1])return;let offset=100;
          try{const info=wx.getWindowInfo(),capsule=wx.getMenuButtonBoundingClientRect();offset=info.statusBarHeight+Math.max(44,capsule.height+2*(capsule.top-info.statusBarHeight))+12;}catch(_){}
          wx.pageScrollTo({scrollTop:Math.max(0,rects[0].top+rects[1].scrollTop-offset),duration:250});
        });};
        if(typeof wx.nextTick==='function')wx.nextTick(scroll);else setTimeout(scroll,100);
      });
    },
    error(err) { wx.showModal({ title: '暂未完成', content: err.message || err.errMsg || '请重试', showCancel: false }); },
  }
});
