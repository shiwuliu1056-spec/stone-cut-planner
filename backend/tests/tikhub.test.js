'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTikHubRequest,
  createDownloadToken,
  extractShareUrl,
  extractWechatIdentifier,
  normalizeTikHubResponse,
  parseVideo,
  validatePublicVideoUrl,
  videoResponseShape,
  verifyDownloadToken,
} = require('../src/tikhub');

function makeShortVideoResponse(overrides = {}) {
  return {
    code: 200,
    data: {
      aweme_detail: {
        aweme_type: 0,
        video: {
          duration: 12345,
          play_addr_h264: { url_list: ['https://media.example/video.mp4'] },
          ...overrides,
        },
      },
    },
  };
}

test('手动选择平台后校验对应的分享链接', () => {
  assert.equal(extractShareUrl('复制打开抖音 https://v.douyin.com/abc123/ 一起看', 'douyin'), 'https://v.douyin.com/abc123/');
  assert.equal(extractShareUrl('http://xhslink.com/o/demo', 'xiaohongshu'), 'http://xhslink.com/o/demo');
});

test('平台与链接不匹配时直接拒绝', () => {
  assert.throws(() => extractShareUrl('https://v.douyin.com/abc123/', 'xiaohongshu'), /当前选择的是小红书/);
  assert.throws(() => extractShareUrl('https://www.tiktok.com.com.evil.example/video', 'tiktok'), /对应平台/);
  assert.throws(() => extractShareUrl('https://example.com/video', 'tiktok'), /对应平台/);
});

test('视频号支持视频 ID、exportId 和携带参数的链接', () => {
  assert.deepEqual(extractWechatIdentifier('1234567890'), { name: 'id', value: '1234567890' });
  assert.deepEqual(extractWechatIdentifier('exportId=export/AbC_123-xyz'), { name: 'exportId', value: 'export/AbC_123-xyz' });
  assert.deepEqual(extractWechatIdentifier('https://channels.weixin.qq.com/test?exportId=export%2Fdemo123'), { name: 'exportId', value: 'export/demo123' });
  assert.deepEqual(extractWechatIdentifier('https://weixin.qq.com/sph/AYhnfNbMwG'), { name: 'shareUrl', value: 'https://weixin.qq.com/sph/AYhnfNbMwG' });
  assert.deepEqual(extractWechatIdentifier('分享视频 https://weixin.qq.com/sph/AYhnfNbMwG 一起看'), { name: 'shareUrl', value: 'https://weixin.qq.com/sph/AYhnfNbMwG' });
});

test('视频号非法 ID、exportId 和伪装域名在计费前拒绝', () => {
  assert.throws(() => extractWechatIdentifier('exportId=demo123'), /export\//);
  assert.throws(() => extractWechatIdentifier('export/ bad'), /export\//);
  assert.throws(() => extractWechatIdentifier('id=abc123'), /纯数字/);
  assert.throws(() => extractWechatIdentifier('https://evil.example/test?id=1234567890'), /对应平台/);
  assert.throws(() => extractWechatIdentifier('https://weixin.qq.com.evil.example/sph/AYhnfNbMwG'), /对应平台/);
  assert.throws(() => extractWechatIdentifier('http://weixin.qq.com/sph/AYhnfNbMwG'), /格式无效/);
});

test('视频号 sph 分享短链直接构造 TikHub v2 POST 请求体', () => {
  const built = buildTikHubRequest('https://weixin.qq.com/sph/AYhnfNbMwG', 'wechat_channels');
  assert.equal(built.endpoint.pathname, '/api/v1/wechat_channels/v2/fetch_video_detail');
  assert.equal(built.endpoint.search, '');
  assert.deepEqual(built.requestOptions, {
    method: 'POST',
    body: { raw: false, share_url: 'https://weixin.qq.com/sph/AYhnfNbMwG' },
  });
});

test('视频号分享短链只调用一次 TikHub，不请求微信公开接口', async () => {
  let tikHubCalls = 0;
  const result = await parseVideo('https://weixin.qq.com/sph/AYhnfNbMwG', 'wechat_channels', {
    apiKey: 'server-only-key',
    requestJson: async (target, key, requestOptions) => {
      tikHubCalls += 1;
      assert.equal(key, 'server-only-key');
      assert.equal(target.pathname, '/api/v1/wechat_channels/v2/fetch_video_detail');
      assert.deepEqual(requestOptions, {
        method: 'POST',
        body: { raw: false, share_url: 'https://weixin.qq.com/sph/AYhnfNbMwG' },
      });
      assert.equal(target.search, '');
      return {
        code: 200,
        data: { object_desc: { media: [{
          url: 'https://finder.video.qq.com/video.mp4',
          url_token: '?token=demo',
          decode_key: '1234',
        }] } },
      };
    },
  });
  assert.equal(tikHubCalls, 1);
  assert.equal(result.videoUrl, 'https://finder.video.qq.com/video.mp4?token=demo');
});

test('四个平台分别路由到 TikHub 对应接口', () => {
  const cases = [
    ['douyin', 'https://v.douyin.com/demo/', '/douyin/app/v3/fetch_one_video_by_share_url', 'share_url'],
    ['tiktok', 'https://www.tiktok.com/@demo/video/123', '/tiktok/app/v3/fetch_one_video_by_share_url', 'share_url'],
    ['xiaohongshu', 'http://xhslink.com/o/demo', '/xiaohongshu/app_v2/get_video_note_detail', 'share_text'],
    ['wechat_channels', 'exportId=export/demo123', '/wechat_channels/v2/fetch_video_detail', null],
  ];
  for (const [platform, input, path, parameter] of cases) {
    const built = buildTikHubRequest(input, platform);
    assert.equal(built.platform, platform);
    assert.match(built.endpoint.pathname, new RegExp(path));
    assert.equal(built.endpoint.origin, 'https://api.tikhub.dev');
    if (parameter) assert.ok(built.endpoint.searchParams.get(parameter));
    else assert.equal(built.requestOptions.body.export_id, 'export/demo123');
  }
});

test('抖音和 TikTok 优先提取无水印播放地址', () => {
  assert.deepEqual(normalizeTikHubResponse(makeShortVideoResponse(), 'douyin'), {
    durationMs: 12345,
    videoUrl: 'https://media.example/video.mp4',
  });
  assert.deepEqual(normalizeTikHubResponse(makeShortVideoResponse({
    download_no_watermark_addr: { url_list: ['https://media.example/no-watermark.mp4'] },
  }), 'tiktok'), {
    durationMs: 12345,
    videoUrl: 'https://media.example/no-watermark.mp4',
  });
});

test('TikTok App V3 的 aweme_details 数组提取无水印地址', () => {
  const response = {
    code: 200,
    data: {
      aweme_details: [{
        aweme_type: 0,
        video: {
          duration: 23456,
          download_no_watermark_addr: { url_list: ['https://media.example/tiktok-clean.mp4'] },
          play_addr: { url_list: ['https://media.example/tiktok-play.mp4'] },
        },
      }],
    },
  };
  assert.deepEqual(normalizeTikHubResponse(response, 'tiktok'), {
    durationMs: 23456,
    videoUrl: 'https://media.example/tiktok-clean.mp4',
  });
});

test('嵌套的抖音作品详情及驼峰播放字段也能识别', () => {
  const response = {
    code: 200,
    data: { data: { aweme_details: [{
      aweme_type: 0,
      image_infos: [],
      video: { duration: 19000, playAddr: { UrlList: ['https://media.example/douyin.mp4'] } },
    }] } },
  };
  assert.deepEqual(normalizeTikHubResponse(response, 'douyin'), {
    durationMs: 19000,
    videoUrl: 'https://media.example/douyin.mp4',
  });
});

test('作品有附带图片字段但同时含视频时仍优先解析视频', () => {
  const response = { code: 200, data: { aweme_detail: {
    aweme_type: 0,
    image_infos: [{ cover: 'https://media.example/cover.jpg' }],
    video: { duration: 7000, play_addr: { url_list: ['https://media.example/video.mp4'] } },
  } } };
  assert.equal(normalizeTikHubResponse(response, 'douyin').videoUrl, 'https://media.example/video.mp4');
});

test('视频字段缺失属于媒体结构问题，不再责怪分享链接不可下载', () => {
  assert.throws(() => normalizeTikHubResponse({ code: 200, data: { aweme_detail: { aweme_type: 0 } } }, 'douyin'),
    (error) => error.statusCode === 502 && /没有视频媒体字段/.test(error.message));
  assert.throws(() => normalizeTikHubResponse({ code: 200, data: { aweme_detail: {
    aweme_type: 0, video: { play_addr: { url_list: [] } },
  } } }, 'douyin'),
  (error) => error.statusCode === 502 && /没有可用的 HTTPS 视频地址/.test(error.message));
});

test('TikHub 明确标记图文时说明媒体类型，不再称链接不可下载', () => {
  assert.throws(() => normalizeTikHubResponse({ code: 200, data: {
    aweme_detail: { aweme_type: 68, image_infos: [{}] },
  } }, 'douyin'),
  (error) => error.statusCode === 400 && /标记为图文/.test(error.message));
  assert.throws(() => normalizeTikHubResponse({ code: 200, data: { data: {
    note_info: { type: 'normal', images: [{}] },
  } } }, 'xiaohongshu'),
  (error) => error.statusCode === 400 && /标记为图文/.test(error.message));
});

test('小红书视频笔记无地址时报告上游媒体结构问题', () => {
  assert.throws(() => normalizeTikHubResponse({ code: 200, data: { data: {
    note_info: { type: 'video', video_info: { media: {} } },
  } } }, 'xiaohongshu'),
  (error) => error.statusCode === 502 && /未识别到视频地址/.test(error.message));
});

test('脱敏诊断只包含字段路径与协议，不泄露媒体地址、密钥或作品内容', () => {
  const response = { code: 200, data: { data: {
    note_info: { type: 'video', video_info: {
      media: { master_url: 'https://media.example/private.mp4?token=top-secret' },
    } },
  } } };
  const diagnostic = videoResponseShape(response, 'xiaohongshu');
  assert.equal(diagnostic.xiaohongshuNoteType, 'video');
  assert.ok(diagnostic.mediaFields.some((field) => field.path.includes('master_url') && field.kind === 'https-url'));
  assert.equal(JSON.stringify(diagnostic).includes('media.example'), false);
  assert.equal(JSON.stringify(diagnostic).includes('top-secret'), false);
});

test('小红书视频笔记提取最高清播放地址并排除封面', () => {
  const response = {
    code: 200,
    data: {
      note: {
        cover: { url: 'https://media.example/cover.jpg' },
        video: { media: { stream: { h264: [
          { height: 720, width: 1280, master_url: 'https://media.example/720.mp4' },
          { height: 1080, width: 1920, master_url: 'https://media.example/1080.mp4' },
        ] } } },
      },
    },
  };
  assert.equal(normalizeTikHubResponse(response, 'xiaohongshu').videoUrl, 'https://media.example/1080.mp4');
});

test('小红书 App V2 数组响应接受 HTTP h265 视频 CDN，不把封面当视频', () => {
  const response = { code: 200, data: { data: [{ video_info_v2: {
    image: { thumbnail: 'https://media.example/cover.jpg' },
    media: { stream: { h265: [
      { height: 720, width: 1280, master_url: 'http://media.example/720.mp4' },
      { height: 1080, width: 1920, master_url: 'http://media.example/1080.mp4',
        backup_urls: ['http://media.example/backup.mp4'] },
    ] } },
  } }] } };
  assert.equal(normalizeTikHubResponse(response, 'xiaohongshu').videoUrl, 'http://media.example/1080.mp4');
});

test('HTTP 媒体代理仅允许小红书，仍拒绝本机和私网地址', async () => {
  await assert.rejects(validatePublicVideoUrl('http://127.0.0.1/private.mp4', 'xiaohongshu'), /不安全/);
  await assert.rejects(validatePublicVideoUrl('http://127.0.0.1/private.mp4', 'douyin'), /无效/);
  await assert.rejects(validatePublicVideoUrl('http://127.0.0.1:8080/private.mp4', 'xiaohongshu'), /无效/);
});

test('视频号响应合并 CDN token 并保留解密密钥', () => {
  const response = {
    code: 200,
    data: { object_desc: { media: [{
      url: 'https://finder.video.qq.com/video.mp4?x=1',
      url_token: '&token=abc',
      decode_key: '2136343393',
      duration_ms: 9876,
    }] } },
  };
  assert.deepEqual(normalizeTikHubResponse(response, 'wechat_channels'), {
    decodeKey: '2136343393',
    durationMs: 9876,
    videoUrl: 'https://finder.video.qq.com/video.mp4?x=1&token=abc',
  });
});

test('视频号 v2 精简响应优先使用 full_url，并将上游 HTTP 地址升级为 HTTPS', () => {
  const response = {
    code: 200,
    data: { media: {
      url: 'http://finder.video.qq.com/video.mp4',
      url_token: '?token=old',
      full_url: 'http://finder.video.qq.com/video.mp4?token=v2',
      decode_key: '2136343393',
      duration: 23,
    } },
  };
  assert.deepEqual(normalizeTikHubResponse(response, 'wechat_channels'), {
    decodeKey: '2136343393',
    durationMs: 23000,
    videoUrl: 'https://finder.video.qq.com/video.mp4?token=v2',
  });
});

test('解析请求仅向后端 TikHub 请求携带 API Key', async () => {
  let requestedUrl = '';
  const result = await parseVideo('https://v.douyin.com/abc123/', 'douyin', {
    apiKey: 'server-only-key',
    requestJson: async (target, key) => {
      requestedUrl = target.toString();
      assert.equal(key, 'server-only-key');
      return makeShortVideoResponse();
    },
  });
  assert.match(requestedUrl, /fetch_one_video_by_share_url/);
  assert.match(requestedUrl, /share_url=/);
  assert.equal(result.platformLabel, '抖音');
  assert.equal(JSON.stringify(result).includes('server-only-key'), false);
});

test('正式作品只调用一次 TikHub，不执行平台官网免费抓取钩子', async () => {
  let tikHubCalls = 0;
  let publicPageCalls = 0;
  const result = await parseVideo('https://www.tiktok.com/@demo/video/1234567890123', 'tiktok', {
    apiKey: 'server-key',
    tryParseFree: async () => { publicPageCalls += 1; return null; },
    requestJson: async () => { tikHubCalls += 1; return makeShortVideoResponse(); },
  });
  assert.equal(publicPageCalls, 0);
  assert.equal(tikHubCalls, 1);
  assert.equal(result.videoUrl, 'https://media.example/video.mp4');
});

test('参数不匹配与 TikHub 业务错误都不会触发第二次计费请求', async () => {
  let calls = 0;
  await assert.rejects(() => parseVideo('https://v.douyin.com/demo/', 'tiktok', {
    apiKey: 'server-key',
    requestJson: async () => { calls += 1; return makeShortVideoResponse(); },
  }), /对应平台/);
  assert.equal(calls, 0, '平台不匹配应在调用 TikHub 前拒绝');

  await assert.rejects(() => parseVideo('https://v.douyin.com/demo/', 'douyin', {
    apiKey: 'server-key',
    requestJson: async () => { calls += 1; return { code: 402, data: null }; },
  }), (error) => error.statusCode === 503 && /余额不足/.test(error.message));
  assert.equal(calls, 1, '余额不足不得继续尝试其他 TikHub 接口');
});

test('私密或删除作品返回明确错误且不触发额外 TikHub 请求', async () => {
  for (const [reason, message] of [[5, /私密/], [8, /删除/]]) {
    let calls = 0;
    await assert.rejects(() => parseVideo('https://v.douyin.com/demo/', 'douyin', {
      apiKey: 'server-key',
      requestJson: async () => {
        calls += 1;
        return { code: 200, data: { filter_list: [{ reason }] } };
      },
    }), message);
    assert.equal(calls, 1);
  }
});

test('视频下载令牌可保护视频号解密密钥', () => {
  const now = 1700000000000;
  const descriptor = { videoUrl: 'https://media.example/video.mp4', platform: 'wechat_channels', decodeKey: '2136343393' };
  const token = createDownloadToken(descriptor, { secret: 'test-secret', now });
  assert.deepEqual(verifyDownloadToken(token, { secret: 'test-secret', now: now + 1000 }), {
    url: 'https://media.example/video.mp4', platform: 'wechat_channels', decodeKey: '2136343393',
  });
  assert.equal(token.includes('2136343393'), false);
  assert.equal(token.includes('media.example'), false);
  assert.throws(() => verifyDownloadToken(`${token}x`, { secret: 'test-secret', now: now + 1000 }), /无效/);
  assert.throws(() => verifyDownloadToken(token, { secret: 'test-secret', now: now + 31 * 60 * 1000 }), /过期/);
});
