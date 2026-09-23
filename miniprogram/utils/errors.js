// 文件用途：把底层错误信息翻译成面向用户的中文文案，避免英文/代码细节直接弹出。
// 约定：只有"包含中文"的消息才原样透传（这些是后端/前端主动写好的用户提示）；
// 英文消息（如 request:fail、第三方库 errMsg）统一落到兜底文案，不暴露技术细节。

// 需要特殊识别的中文关键词 -> 更友好的固定文案（可读性优先）。
const FRIENDLY_RULES = [
  { match: /本地后端连接失败|127\.0\.0\.1|请先启动/, text: '服务暂时不可用，请稍后重试' },
  { match: /配置 API 地址|尚未配置|服务不可用|尚未配置/, text: '服务暂未开通，请稍后重试' },
  { match: /过于频繁|频繁/, text: '操作太频繁了，请稍后再试' },
  { match: /超时|耗时较长/, text: '请求超时，请检查网络后重试' },
  { match: /解析.*令牌|令牌.*不匹配|重新解析/, text: '解析信息已失效，请重新解析后重试' },
];

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

/**
 * 返回适合弹窗展示的中文提示。
 * @param {*} error 捕获到的错误对象
 * @param {string} fallback 兜底文案
 */
function userMessage(error, fallback) {
  const raw = String((error && (error.message || error.errMsg)) || '').trim();
  if (!raw) return fallback;

  // 纯英文/技术字符串（含 errMsg 前缀、异常堆栈风格）不直接展示。
  if (!hasChinese(raw)) return fallback;

  // 命中特殊规则的，换成更友好的固定文案。
  for (const rule of FRIENDLY_RULES) {
    if (rule.match.test(raw)) return rule.text;
  }

  // 其余含中文的消息视为已写好的用户提示，原样返回（截断过长内容）。
  return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
}

module.exports = { userMessage };
