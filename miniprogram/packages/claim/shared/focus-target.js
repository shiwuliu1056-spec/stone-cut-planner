const aliases={'uploads:plaintiff':'identityMaterials','uploads:agent':'agentFiles','uploads:defendant':'defendantFiles','uploads:evidence':'evidence'};
function resolveTarget(requested,step,fields,state,identityRows,evidenceRows,preferredRowId,defendantRows){
  let key=aliases[requested]||requested||'';
  const visible=field=>fields.some(item=>item.key===field);
  if(key==='defendantMaterials')key='defendantFiles';
  if(key==='defendantFiles'&&defendantRows&&defendantRows.length){const row=defendantRows.find(item=>item.id===preferredRowId)||defendantRows.find(item=>!item.name)||defendantRows[0];return {key,rowId:row.id,domId:'defendant-row-'+row.id};}
  if(key==='identityMaterials'){const row=identityRows.find(item=>item.id===preferredRowId)||identityRows.find(item=>!item.name||!item.count)||identityRows[0];return {key,rowId:row?row.id:'',domId:row?'identity-row-'+row.id:'field-identityMaterials'};}
  if(key==='evidence'){const row=evidenceRows.find(item=>item.id===preferredRowId)||evidenceRows.find(item=>!item.name||!item.source||!item.purpose||(item.kind==='media'?!(Number.isInteger(Number(item.fileCount))&&Number(item.fileCount)>0):!item.count));return {key,rowId:row?row.id:'',domId:row?'evidence-row-'+row.id:'field-evidence'};}
  if(['agentFiles','defendantFiles','jurisdictionBases'].includes(key))return {key,rowId:'',domId:'field-'+key};
  if(!visible(key)){
    const fallback={interestTerms:'claimInterest',attorneyFeeTerms:'claimAttorneyFee',jurisdictionClause:'jurisdictionAgreement',dealFormation:'contractForm',deliveryReceipt:'contractForm',priceBasis:'contractForm'};
    if(key.startsWith('agent'))key='represented';else if(key.startsWith('refund'))key='includeRefundAccount';else if(key.startsWith('plaintiff'))key='plaintiffType';else if(key.startsWith('defendant'))key='defendantType';else key=fallback[key]||key;
    if(!visible(key)&&key==='jurisdictionAgreement')key='contractForm';
  }
  if(visible(key))return {key,rowId:'',domId:'field-'+key};
  if(step===1)return resolveTarget('identityMaterials',step,fields,state,identityRows,evidenceRows);
  if(step===3)return resolveTarget('evidence',step,fields,state,identityRows,evidenceRows);
  const field=fields.find(item=>item.required&&!state[item.key])||fields[0];
  return field?{key:field.key,rowId:'',domId:'field-'+field.key}:{key:'column',rowId:'',domId:'focus-column'};
}
module.exports={resolveTarget};
