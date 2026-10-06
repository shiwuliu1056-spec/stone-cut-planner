import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReview,reviewCase,optimizeCase,normalizeOptimization} from '../review.mjs';
const payload={allowedFields:['totalAmount'],fieldSteps:{totalAmount:[0]}};
test('AI null entries, wrapped JSON and wrong steps normalize without throwing',()=>{
  const result=normalizeReview('结果如下：```json\n{"summary":"检查完成","issues":[null,{"title":"金额","advice":"核对","step":3,"field":"totalAmount"}]}\n```',payload);
  assert.equal(result.issues.length,1);assert.equal(result.issues[0].step,0);
  assert.throws(()=>normalizeReview('not JSON',payload),/AI返回格式/);
});
test('AI hints use content titles instead of internal field names',()=>{
  const result=normalizeReview({issues:[{field:'claimInterest',title:'claimInterest不一致',advice:'claimInterest为false但interestTerms有内容'}]},{allowedFields:['claimInterest'],fieldSteps:{claimInterest:[0]},fieldLabels:{claimInterest:'利息诉求开关',interestTerms:'利息计算方式'}});
  assert.ok(result.issues[0].advice.includes('利息计算方式'));assert.ok(!/claimInterest|interestTerms|false/.test(result.issues[0].advice));
});
test('optimization only changes existing text and preserves numbers and switches',async()=>{
  const input={fields:{demandHistory:'我在2026年5月催款，对方说稍后支付，但一直没给。',claimInterest:false,totalAmount:'40000'},editableFields:['demandHistory'],fieldLabels:{demandHistory:'我是怎么催款的'}};
  const output=normalizeOptimization(JSON.stringify({changes:[{field:'demandHistory',after:'2026年5月，我向对方催款。对方说稍后支付，但至今未付。'},{field:'claimInterest',after:true},{field:'totalAmount',after:'45000'}]}),input);
  assert.equal(output.changes.length,1);assert.equal(output.changes[0].field,'demandHistory');
  assert.equal(normalizeOptimization(JSON.stringify({changes:[{field:'demandHistory',after:'2027年5月，我催款。'}]}),input).changes.length,0);
  const cleared=await optimizeCase({fields:{}},{field:'claimInterest'},{state:{claimInterest:false,interestTerms:'以40000元计算'}});
  assert.deepEqual(cleared.changes,[{field:'interestTerms',before:'以40000元计算',after:''}]);
  let sent;
  const result=await optimizeCase({fields:input.fields,fieldLabels:input.fieldLabels},{field:'demandHistory',title:'措辞重复'},{apiKey:'test',fetchImpl:async(_url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({changes:[{field:'demandHistory',after:'2026年5月，我向对方催款。对方说稍后支付，但至今未付。'}]})}}]})};}});
  assert.equal(result.changes.length,1);assert.ok(sent.messages[0].content.includes('不改变日期、金额'));assert.deepEqual(JSON.parse(sent.messages[1].content).editableFields,['demandHistory']);
});
test('AI uses bounded JSON output and recovers from transient connection failures',async()=>{
  let calls=0;const result=await reviewCase(payload,{apiKey:'test',fetchImpl:async(_url,options)=>{
    const data=JSON.parse(options.body);assert.equal(data.thinking.type,'disabled');assert.equal(data.response_format.type,'json_object');assert.ok(data.max_tokens<=3000);
    if(++calls===1)throw new TypeError('network');return {ok:true,json:async()=>({choices:[{message:{content:'{"summary":"检查完成","issues":[]}'}}]})};
  }});assert.equal(calls,2);assert.equal(result.issues.length,0);
});
