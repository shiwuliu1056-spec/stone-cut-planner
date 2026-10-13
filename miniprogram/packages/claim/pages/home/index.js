// 兼容旧入口：返回已有案件总览，否则替换旧入口并保留底层目录。
const navigation = require('../../../../shared/tool-navigation');
Page({
  onLoad() {
    navigation.returnToClaim();
  },
});
