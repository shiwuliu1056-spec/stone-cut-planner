const draft=require('./draft');
const {issueUrl}=require('./issue-links');
let session=null;
let serial=0;
function start(items,index,kind){
  session={id:String(++serial),caseId:draft.get().caseId,kind:kind==='ai'?'ai':'system',items:items.map(item=>Object.assign({},item))};
  return url(session.id,index);
}
function info(id,index){
  index=Number(index);
  if(!session||session.id!==String(id)||session.caseId!==draft.get().caseId||!Number.isInteger(index)||index<0||index>=session.items.length)return null;
  return {id:session.id,index,total:session.items.length,kind:session.kind,label:session.kind==='ai'?'AI检查':'系统检查',item:session.items[index]};
}
function url(id,index){
  const current=info(id,index);
  return current?issueUrl(current.item)+'&checks='+encodeURIComponent(current.id)+'&checkIndex='+current.index:'';
}
function move(id,index,delta){
  const current=info(id,index);
  if(!current)return {message:'检查列表已更新，请返回检查页重新选择'};
  const next=current.index+delta;
  if(next<0)return {message:'已经是第一项'};
  if(next>=current.total)return {message:'已经是最后一项'};
  return {url:url(id,next)};
}
module.exports={start,info,url,move};
