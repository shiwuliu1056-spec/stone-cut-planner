const {readTarget}=require('./issue-links');
const navigation=require('./check-navigation');
module.exports=function(step){
  return {
    data:{fromReview:false,checks:'',checkIndex:0,checkTotal:0,checkKind:'system',checkLabel:'系统检查',canOptimize:false,optimizationIssue:null},
    onLoad(query){const target=readTarget(query),current=navigation.info(query&&query.checks,query&&query.checkIndex);this.targetField=target.field;this.targetHint=target.hint;this.targetRowId=target.row;this.shouldFocus=target.shouldFocus;this.setData({fromReview:target.fromReview,checks:current?current.id:'',checkIndex:current?current.index:0,checkTotal:current?current.total:0,checkKind:current?current.kind:'system',checkLabel:current?current.label:'系统检查',canOptimize:!!(current&&current.kind==='ai'&&current.item.canOptimize),optimizationIssue:current?current.item:null});},
    onShow(){const component=this.selectComponent('#form');if(component){component.reload();if(step===5)component.ensureReview();if(this.shouldFocus){component.focusField(this.targetField,this.targetHint,this.targetRowId);this.shouldFocus=false;}}},
    onReady(){const component=this.selectComponent('#form');component.reload();if(this.shouldFocus){component.focusField(this.targetField,this.targetHint,this.targetRowId);this.shouldFocus=false;}},
    onHide(){const draft=require('./draft');draft.get().completion=draft.issues().completion;draft.persist(false);}
  };
};
