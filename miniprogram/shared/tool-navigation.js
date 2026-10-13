// 原生页面栈负责侧滑返回，业务层不拦截触摸或系统返回。
const HOME = 'pages/index/index';
const tools = ['cut', 'watermark', 'claim'];
let videoSnapshot;
const videoFields = ['platformIndex', 'platform', 'platformLabel', 'inputTitle', 'inputPlaceholder',
  'link', 'result', 'mediaToken', 'videoUrl', 'transcript', 'transcriptStatus', 'transcriptError',
  'transcriptRequested', 'transcriptExpanded', 'transcriptCanExpand'];

function openTool(page, tool, vibrate = true) {
  if (!tools.includes(tool) || page.openingTool || page.pageDestroyed) return;
  page.openingTool = true;
  wx.navigateTo({
    url: '/' + HOME + '?tool=' + tool,
    success() { if (vibrate) wx.vibrateShort({ type: 'light', fail() {} }); },
    fail() {
      page.openingTool = false;
      wx.showToast({ title: '暂时无法打开工具，请重试', icon: 'none' });
    },
  });
}

function returnToToolbox() {
  const pages = getCurrentPages();
  const index = pages.findIndex(page => page.route === HOME && page.data.tool === 'home');
  const delta = pages.length - 1 - index;
  if (index >= 0 && delta > 0) wx.navigateBack({ delta });
  else if (index < 0) wx.reLaunch({ url: '/' + HOME });
}

function returnToClaim() {
  const pages = getCurrentPages();
  let index = -1;
  for (let i = pages.length - 1; i >= 0; i--) {
    if (pages[i].route === HOME && pages[i].data.tool === 'claim') { index = i; break; }
  }
  if (index >= 0) {
    const delta = pages.length - 1 - index;
    if (delta > 0) wx.navigateBack({ delta });
  } else if (pages.some(page => page.route === HOME && page.data.tool === 'home')) {
    // 兼容旧分包链接：替换旧入口，保留底层目录，不改变目录的工具状态。
    wx.redirectTo({ url: '/' + HOME + '?tool=claim' });
  } else {
    wx.reLaunch({ url: '/' + HOME + '?tool=claim' });
  }
}

function rememberVideo(data) {
  if (data.tool !== 'watermark') return;
  videoSnapshot = {};
  videoFields.forEach(key => { videoSnapshot[key] = data[key]; });
}

module.exports = { openTool, returnToToolbox, returnToClaim, rememberVideo,
  restoreVideo: () => videoSnapshot || {} };
