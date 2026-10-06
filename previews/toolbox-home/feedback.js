// 独立网页预览的轻震动；不支持震动的设备仍保留 CSS 按压反馈。
// 接入微信小程序时，入口应沿用 wx.vibrateShort({ type: 'light' })。
document.querySelectorAll('.tool-card').forEach(card => {
  card.addEventListener('click', () => {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(10);
  });
});
