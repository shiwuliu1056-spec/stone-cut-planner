const schema=require('./schema');
const labels={identityMaterials:'身份证明材料',defendantMaterials:'被告线索材料',evidence:'证据目录',jurisdictionBases:'案件为什么由这个法院受理'};
schema.steps.forEach(step=>step.fields.forEach(field=>{if(!labels[field.key])labels[field.key]=field.label;}));
function humanHint(value){
  let text=String(value||'');
  Object.keys(labels).sort((a,b)=>b.length-a.length).forEach(key=>{text=text.replace(new RegExp('\\b'+key+'\\b','g'),'“'+labels[key]+'”');});
  return text.replace(/\bfalse\b/g,'未开启').replace(/\btrue\b/g,'已开启').replace(/\b[a-z]+[A-Z][A-Za-z0-9]*\b/g,'相关填写内容');
}
module.exports={humanHint,labels};
