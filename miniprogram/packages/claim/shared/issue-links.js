const draft=require('./draft');
function decodeParam(value){
  let text=String(value||'');
  for(let i=0;i<2&&/%[0-9a-f]{2}/i.test(text);i++){try{const decoded=decodeURIComponent(text);if(decoded===text)break;text=decoded;}catch(_){break;}}
  return text;
}
function issueUrl(issue){
  const step=Number.isInteger(issue.step)&&issue.step>=0&&issue.step<5?issue.step:0;
  return draft.pagePath(step)+'?fromReview=1&field='+encodeURIComponent(issue.field||'')+'&hint='+encodeURIComponent((issue.advice||issue.title||'').slice(0,120))+'&row='+encodeURIComponent(issue.targetRowId||'');
}
function readTarget(query){query=query||{};const field=decodeParam(query.field),hint=decodeParam(query.hint);return {field,hint,row:decodeParam(query.row),fromReview:query.fromReview==='1'||!!hint,shouldFocus:!!(field||hint)};}
module.exports={decodeParam,issueUrl,readTarget};
