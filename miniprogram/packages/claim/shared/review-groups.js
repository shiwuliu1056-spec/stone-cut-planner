function groupIssues(issues,steps){
  const groups=new Map();
  (issues||[]).forEach((issue,index)=>{
    const step=Number.isInteger(issue.step)&&issue.step>=0&&issue.step<5?issue.step:5;
    if(!groups.has(step))groups.set(step,{step,number:step<5?String(step+1).padStart(2,'0'):'',title:step<5?steps[step].title:'其他需核对事项',items:[]});
    groups.get(step).items.push(Object.assign({},issue,{sourceIndex:index}));
  });
  const result=Array.from(groups.values()).sort((a,b)=>a.step-b.step);
  let number=0;
  result.forEach(group=>group.items.forEach(item=>{item.displayNumber=++number;}));
  return result;
}
const AI_CATEGORIES=[{key:'party',title:'当事人与受理'},{key:'claim',title:'诉求与金额'},{key:'facts',title:'事实与证据'},{key:'wording',title:'表述与一致性'}];
function aiCategory(issue){
  const field=String(issue.field||''),title=String(issue.title||'');
  if(/矛盾|不一致|前后|表述|措辞|冗余|重复|歧义/.test(title))return 'wording';
  if(/Amount|Interest|interest|Fee|fee|claim|refund|paymentDue|refund/i.test(field)||/金额|利息|利率|费用|诉求|诉讼请求|本金|计算|欠款数额/.test(title))return 'claim';
  if(/evidence|contractForm|contractName|goods|delivery|receipt|transaction|demand|refusal|paymentHistory|facts/i.test(field)||issue.step===3||/证据|送货|签收|交易|催款|付款|事实|时间|日期|合同/.test(title))return 'facts';
  if(/plaintiff|defendant|identity|agent|represent|service|court|jurisdiction|arbitration/i.test(field)||[1,2,4].includes(issue.step)||/原告|被告|身份|主体|管辖|法院|送达|代理|住所|地址/.test(title))return 'party';
  return 'wording';
}
function groupAiIssues(issues){
  const groups=new Map();
  (issues||[]).forEach((issue,sourceIndex)=>{
    const key=aiCategory(issue);
    if(!groups.has(key))groups.set(key,{key,title:AI_CATEGORIES.find(item=>item.key===key).title,items:[]});
    groups.get(key).items.push(Object.assign({},issue,{sourceIndex,canOptimize:key==='wording'}));
  });
  const result=AI_CATEGORIES.filter(category=>groups.has(category.key)).map(category=>groups.get(category.key));
  let number=0;result.forEach(group=>group.items.forEach(item=>{item.displayNumber=++number;}));
  return result;
}
module.exports={groupIssues,groupAiIssues};
