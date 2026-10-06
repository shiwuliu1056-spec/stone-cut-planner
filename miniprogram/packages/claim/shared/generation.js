const draft=require('./draft');
const api=require('./api');
function stale(result,current){return !result||result.formatVersion!=='word-v1'||result.revision!==current.revision||result.expiresAt<Date.now()||(result.caseId&&result.caseId!==current.caseId)||(result.serviceBase&&result.serviceBase!==api.base());}
async function generate(options){
  options=options||{};const message=options.onMessage||function(){},active=options.isActive||function(){return true;};
  const current=draft.get(),caseId=current.caseId,revision=current.revision;
  const state=JSON.parse(JSON.stringify(current.state)),files=current.files.map(file=>Object.assign({},file));
  function check(){if(draft.get().caseId!==caseId||draft.get().revision!==revision)throw new Error('案件内容已变化，请重新生成');}
  let result=current.result;message('正在准备资料包…');
  if(!stale(result,current)){
    try{result=await api.call('/tasks/'+result.id);}catch(error){if(error.status!==404)throw error;result=null;}
  }else{
    if(result&&(!result.serviceBase||result.serviceBase===api.base())&&result.expiresAt>Date.now()&&!['queued','generating'].includes(result.status))await api.call('/tasks/'+result.id,'DELETE').catch(()=>{});
    result=null;
  }
  if(!active())return null;check();
  if(!result){
    result=await api.call('/tasks','POST',{state,files:draft.manifest()});check();
    draft.clearResultFiles(current.result);current.result=Object.assign({},result,{revision,caseId,localFiles:{},serviceBase:api.base()});draft.persist(false);
  }
  const uploaded=new Set(result.uploadedIds||[]),pending=files.filter(file=>!uploaded.has(file.id));
  let next=0,completed=files.length-pending.length,uploadError;
  if(pending.length)message('正在上传文件 '+completed+' / '+files.length);
  await Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{
    while(next<pending.length&&!uploadError&&active()){
      const file=pending[next++];
      try{check();await api.upload(result.id,file);check();message('正在上传文件 '+(++completed)+' / '+files.length);}
      catch(error){uploadError=uploadError||error;}
    }
  }));
  if(uploadError)throw uploadError;
  if(!active())return null;check();message('正在生成Word和资料包…');
  const task=await api.call('/tasks/'+result.id+'/generate','POST',{});check();
  Object.assign(current.result,task);draft.persist(false);return task;
}
module.exports={generate,stale};
