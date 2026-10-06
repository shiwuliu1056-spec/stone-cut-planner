const schema = require('./schema');
const contract = require('./contract');
const config = require('./config');
const KEY = 'jiujiang-claim-mini-v1';
const NOTE = '影音文件未编入本文档，请在法院平台按本证据编号另行上传。';
const paths = ['complaint','identity','defendant','evidence','service','review'];
function id() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,12); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function identity(type) { return { id: id(), name: type === '个人' ? '身份证' : '营业执照', customized: false }; }
function evidence(kind) { return { id: id(), kind: kind, name: '', copyType: kind === 'document' ? '复印件' : '', source: '原告提供', purpose: '', note: kind === 'media' ? NOTE : '', mediaType: kind === 'media' ? '视频' : '', fileCount: kind === 'media' ? 1 : 0 }; }
function fresh(sample) {
  const state = clone(sample ? schema.sample : schema.defaults);
  state.identityMaterials = [identity(state.plaintiffType)];
  state.defendantMaterials = [{id:id(),name:''}];
  state.claimInterest=false;state.interestTerms='';
  state.evidence = [evidence('document')];
  if (sample) Object.assign(state.evidence[0], schema.sample.evidence[0], { id: id() });
  return { version: 1, caseId: id(), state: state, files: [], revision: 0, result: null, ai: null };
}
let cached;
function get() {
  if (!cached) { const saved = wx.getStorageSync(KEY); cached = saved && saved.version === 1 ? saved : fresh(false); }
  if (!cached.caseId) { cached.caseId = id(); wx.setStorageSync(KEY,cached); }
  if(!Array.isArray(cached.state.defendantMaterials)||!cached.state.defendantMaterials.length){
    const files=cached.files.filter(file=>file.group==='defendant'),row={id:id(),name:files.length?'被告信息材料':''};
    cached.state.defendantMaterials=[row];files.forEach(file=>{file.materialId=row.id;});cached.revision=(cached.revision||0)+1;cached.ai=null;wx.setStorageSync(KEY,cached);
  }
  cached.state.evidence.forEach(item=>{if(item.kind==='media'&&item.note==='影音文件未编入本PDF，请在法院平台按本证据编号另行上传。'){item.note=NOTE;wx.setStorageSync(KEY,cached);}});
  return cached;
}
function persist(changed) { const draft = get(); if (changed) { draft.revision++; draft.ai = null; } wx.setStorageSync(KEY, draft); return draft; }
function setField(key, value) {
  const draft = get(), state = draft.state, old = state[key];
  if (old === value) return draft;
  if (key === 'plaintiffType') {
    state.identityMaterials.forEach(row => { if (!row.customized && !draft.files.some(f => f.materialId === row.id) && row.name === (old === '个人' ? '身份证' : '营业执照')) row.name = value === '个人' ? '身份证' : '营业执照'; });
  }
  state[key] = value;
  const sync = { plaintiffName: ['serviceRecipient','refundAccountName'], plaintiffAddress: ['serviceAddress'], plaintiffPhone: ['servicePhone','refundPhone'] };
  (sync[key] || []).forEach(target => { if (!state[target] || state[target] === old) state[target] = value; });
  if (key === 'contractForm' && value !== '书面买卖合同') { state.jurisdictionAgreement = 'no'; state.jurisdictionBases = state.jurisdictionBases.filter(x => !x.includes('合同约定')); }
  return persist(true);
}
function updateRow(group, rowId, key, value) {
  const row = get().state[group].find(x => x.id === rowId); if (!row) return;
  row[key] = value; if (group === 'identityMaterials' && key === 'name') row.customized = true;
  persist(true);
}
function addRow(group, kind) { get().state[group].push(group === 'identityMaterials' ? identity(get().state.plaintiffType) : group==='defendantMaterials'?{id:id(),name:''}:evidence(kind)); persist(true); }
function discardFiles(predicate) {
  const draft = get(); const removed = draft.files.filter(predicate);
  draft.files = draft.files.filter(f => !predicate(f));
  removed.forEach(f => { if (f.localPath && f.localPath.startsWith(wx.env.USER_DATA_PATH)) try { wx.getFileSystemManager().unlinkSync(f.localPath); } catch (_) {} });
}
function removeRow(group, rowId) {
  const rows = get().state[group]; if (rows.length <= 1 && ['identityMaterials','defendantMaterials'].includes(group)) return;
  get().state[group] = rows.filter(x => x.id !== rowId);
  discardFiles(f => f.materialId === rowId || f.evidenceId === rowId);
  if (!get().state[group].length) get().state[group].push(evidence('document'));
  persist(true);
}
function removeFile(fileId) { discardFiles(f => f.id === fileId); persist(true); }
async function addFiles(group, rowId, incoming) {
  const extensions = group === 'evidence' ? ['jpg','jpeg','png','webp','pdf','docx','xls','xlsx','csv','txt'] : ['jpg','jpeg','png','pdf','docx'];
  const draft = get(); let total = draft.files.reduce((sum,f) => sum + f.size, 0);
  const messages = []; const fs = wx.getFileSystemManager();
  for (const item of incoming) {
    const name = item.name || '图片-' + id() + '.' + ((item.path || '').split('.').pop().toLowerCase() === 'png' ? 'png' : 'jpg');
    const ext = name.split('.').pop().toLowerCase();
    if (!extensions.includes(ext)) { messages.push(name + '：请转换成支持的格式'); continue; }
    if (!item.size || item.size > config.maxFileBytes || total + item.size > config.maxTotalBytes || draft.files.length >= 100) { messages.push(name + '：超过文件大小或数量限制'); continue; }
    try {
      const saved = await new Promise((resolve, reject) => fs.saveFile({ tempFilePath: item.path, success: resolve, fail: reject }));
      const file = { id: id(), group: group, name: name, size: item.size, localPath: saved.savedFilePath };
      if (group === 'plaintiff'||group==='defendant') file.materialId = rowId;
      if (group === 'evidence') file.evidenceId = rowId;
      draft.files.push(file); total += file.size;
    } catch (_) { messages.push(name + '：本机保存失败，请检查存储空间后重新选择'); }
  }
  persist(true); return messages;
}
function fileType(name) { const ext = name.split('.').pop().toLowerCase(); return ['jpg','jpeg','png','webp'].includes(ext) ? '图片' : ext === 'pdf' ? 'PDF' : ext === 'docx' ? 'Word' : ['xls','xlsx','csv'].includes(ext) ? '表格' : '文字'; }
function manifest() { return get().files.map(f => { const x = { id: f.id, group: f.group, name: f.name, size: f.size }; if (f.materialId) x.materialId = f.materialId; if (f.evidenceId) x.evidenceId = f.evidenceId; return x; }); }
function issues() {
  const draft = get(), state = draft.state, uploads = { plaintiff: [], agent: [], defendant: [], evidence: [] };
  draft.files.forEach(f => uploads[f.group].push(f));
  const result = []; let ok = 0, total = 0;
  const sections = contract.documents.reduce((all, doc) => all.concat(doc.sections), []).concat(contract.platformMaterials || []);
  const seen = {};
  sections.forEach(section => {
    if (['optional','fixed'].includes(section.requirement) || (section.when && !section.when(state, uploads))) return;
    if (seen[section.id]) return; seen[section.id] = true; total++;
    const fields = section.requiredFields || section.fields || [];
    const pass = section.check ? section.check(state, uploads) : fields.every(key => key.startsWith('uploads:') ? uploads[key.slice(8)].length : Array.isArray(state[key]) ? state[key].length : !!state[key]);
    if (pass) ok++; else result.push({ level: 'danger', title: section.title + '未完成', advice: section.hint || '请补充这一项', step: section.step, field: fields.find(key => !key.startsWith('uploads:') && !state[key]) || fields[0] || '' });
  });
  draft.files.forEach(f => { try { wx.getFileSystemManager().accessSync(f.localPath); } catch (_) { result.push({ level: 'danger', title: '文件失效：' + f.name, advice: '请重新选择文件', step: { plaintiff: 1, agent: 1, defendant: 2, evidence: 3 }[f.group], field: 'uploads:'+f.group, targetRowId:f.materialId||f.evidenceId||'' }); } });
  if (+state.paidAmount > +state.totalAmount) result.push({ level: 'danger', title: '已付款高于货款总额', advice: '请核对两个金额', step: 0, field: 'paidAmount' });
  state.defendantMaterials.forEach(row=>{if(draft.files.some(file=>file.group==='defendant'&&file.materialId===row.id)&&!String(row.name||'').trim())result.push({level:'danger',title:'被告线索材料名称未填写',advice:'请为上传的工商信息或地址线索填写材料名称',step:2,field:'defendantMaterials',targetRowId:row.id});});
  state.evidence.forEach((item,index) => { if (item.kind === 'media' && (!Number.isInteger(Number(item.fileCount)) || Number(item.fileCount) <= 0)) result.push({ level: 'danger', title: '证据' + (index + 1) + '的影音数量不是正整数', advice: '请输入1、2、3等正整数', step: 3, field: 'evidence',targetRowId:item.id }); });
  if (!state.jurisdictionBases.length) result.push({ level: 'danger', title: '尚未选择管辖依据', advice: '请填写案件与受理法院的连接点', step: 0, field: 'jurisdictionBases' });
  if (state.arbitration !== 'no') result.push({ level: 'warn', title: state.arbitration === 'yes' ? '已选择存在书面仲裁约定' : '请确认是否签过书面仲裁约定', advice: '核对现有书面材料', step: 0, field: 'arbitration' });
  if (state.evidence.some(x => x.kind === 'media')) result.push({ level: 'info', title: '影音原文件需在法院平台另行上传', advice: '资料包中会列出另行上传清单', step: 3, field: '' });
  return { issues: result, completion: progressSummary().completion };
}
function clearResultFiles(result) {
  if (!result || !result.id) return;
  const directory = wx.env.USER_DATA_PATH + '/claim-result-' + result.id;
  const fs = wx.getFileSystemManager();
  Object.values(result.localFiles || {}).forEach(path => { if (path.startsWith(directory + '/')) try { fs.unlinkSync(path); } catch (_) {} });
  try { fs.rmdirSync(directory); } catch (_) {}
}
function reset(sample) { clearResultFiles(get().result); discardFiles(() => true); cached = fresh(sample); cached.completion = issues().completion; persist(false); }
function replacePlaintiff(fields, materials, files) {
  discardFiles(file => file.group === 'plaintiff');
  Object.keys(schema.defaults).filter(key => key.startsWith('plaintiff')).forEach(key => setField(key, fields[key] === undefined ? schema.defaults[key] : fields[key]));
  get().state.identityMaterials = materials;
  get().files = get().files.concat(files);
  persist(true); get().completion = issues().completion; persist(false);
}
function pagePath(step) { return '/packages/claim/pages/' + paths[step] + '/index'; }
function progressSummary() {
  const current=get(),state=current.state;
  const visible=field=>!field.condition||({'plaintiff-natural':state.plaintiffType==='个人','plaintiff-company':state.plaintiffType!=='个人','defendant-natural':state.defendantType==='个人','defendant-company':state.defendantType!=='个人',written:state.contractForm==='书面买卖合同',unwritten:!!state.contractForm&&state.contractForm!=='书面买卖合同',agent:state.represented==='yes',refund:state.includeRefundAccount})[field.condition];
  const filled=key=>Array.isArray(state[key])?state[key].length>0:state[key]!==''&&state[key]!==null&&state[key]!==undefined;
  const readable=file=>{try{wx.getFileSystemManager().accessSync(file.localPath);return true;}catch(_){return false;}};
  const uploaded=(group,rowId,key)=>current.files.some(file=>file.group===group&&(!rowId||file[key]===rowId)&&readable(file));
  const stats = schema.steps.slice(0,5).map((step,index)=>{
    const keys=new Set(step.fields.filter(field=>field.required&&visible(field)).map(field=>field.key));const checks=[];
    if(index===0){keys.add('totalAmount');keys.add('jurisdictionBases');if(state.claimInterest)keys.add('interestTerms');if(state.claimAttorneyFee)keys.add('attorneyFeeTerms');if(state.contractForm==='书面买卖合同'&&state.jurisdictionAgreement==='yes')keys.add('jurisdictionClause');}
    if(index===1){
      (state.identityMaterials||[]).forEach(row=>{checks.push(!!String(row.name||'').trim());checks.push(uploaded('plaintiff',row.id,'materialId'));});
      if(state.represented==='yes'){['agentName','agentType','agentId','agentPhone'].forEach(key=>keys.add(key));checks.push(uploaded('agent'));}
    }
    if(index===3){
      (state.evidence||[]).forEach(row=>{checks.push(!!String(row.name||'').trim(),!!String(row.source||'').trim(),!!String(row.purpose||'').trim());if(row.kind==='media')checks.push(['录音','视频'].includes(row.mediaType),Number.isInteger(Number(row.fileCount))&&Number(row.fileCount)>0);else checks.push(!!row.copyType,uploaded('evidence',row.id,'evidenceId'));});
    }
    if(index===4){['court','plaintiffName','plaintiffId'].forEach(key=>keys.add(key));if(state.includeRefundAccount)['refundAccountName','refundBankName','refundBankAccount','refundPhone'].forEach(key=>keys.add(key));}
    keys.forEach(key=>checks.push(key==='totalAmount'?Number(state[key])>0:filled(key)));
    return {completed:checks.filter(Boolean).length,total:checks.length};
  });
  const completed=stats.reduce((sum,item)=>sum+item.completed,0),total=stats.reduce((sum,item)=>sum+item.total,0);
  return {columns:stats.map(item=>item.total?Math.round(item.completed/item.total*100):0),completion:total?Math.round(completed/total*100):0};
}
function columnProgress(){return progressSummary().columns;}
function replaceDefendant(fields,files,materials) {
  discardFiles(file=>file.group==='defendant');
  Object.keys(schema.defaults).filter(key=>key.startsWith('defendant')).forEach(key=>setField(key,fields[key]===undefined?schema.defaults[key]:fields[key]));
  const rows=materials&&materials.length?clone(materials):[{id:id(),name:files.length?'被告信息材料':''}];
  get().state.defendantMaterials=rows;files.forEach(file=>{if(!rows.some(row=>row.id===file.materialId))file.materialId=rows[0].id;});
  get().files=get().files.concat(files);persist(true);get().completion=issues().completion;persist(false);
}
module.exports = { get, persist, setField, updateRow, addRow, removeRow, removeFile, addFiles, fileType, manifest, issues, reset, clearResultFiles, replacePlaintiff, replaceDefendant, columnProgress, progressSummary, pagePath, schema, id };
