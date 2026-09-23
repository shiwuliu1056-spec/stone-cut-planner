'use strict';

// 文件用途：验证视频语音转写任务参数、结果清洗和任务令牌安全性。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs').promises;
const path = require('node:path');
const {
  createTranscriptTask,
  createTranscriptTaskFromData,
  createTranscriptToken,
  createWechatTranscriptTask,
  createXiaohongshuTranscriptTask,
  getTranscriptTask,
  normalizeTranscript,
  verifyTranscriptToken,
} = require('../src/transcript');

test('创建转写任务时使用视频 URL 和非增值识别参数', async () => {
  let capturedAction = '';
  let capturedParams = null;
  const taskId = await createTranscriptTask('https://video.example/demo.mp4', {
    requestApi: async (action, params) => {
      capturedAction = action;
      capturedParams = params;
      return { Data: { TaskId: 12345 } };
    },
  });
  assert.equal(taskId, 12345);
  assert.equal(capturedAction, 'CreateRecTask');
  assert.equal(capturedParams.EngineModelType, '16k_zh');
  assert.equal(capturedParams.Url, 'https://video.example/demo.mp4');
  assert.equal(capturedParams.SourceType, 0);
  assert.equal(capturedParams.ResTextFormat, 2);
  assert.equal(capturedParams.ChannelNum, 1);
});

test('创建转写任务时可直接提交 5MB 内的本地音频数据', async () => {
  let capturedParams = null;
  const taskId = await createTranscriptTaskFromData(Buffer.from([1, 2, 3]), {
    requestApi: async (action, params) => {
      assert.equal(action, 'CreateRecTask');
      capturedParams = params;
      return { Data: { TaskId: 67890 } };
    },
  });
  assert.equal(taskId, 67890);
  assert.equal(capturedParams.SourceType, 1);
  assert.equal(capturedParams.Data, 'AQID');
  assert.equal(capturedParams.DataLen, 3);
  assert.equal(Object.hasOwn(capturedParams, 'Url'), false);
  await assert.rejects(() => createTranscriptTaskFromData(Buffer.alloc(5 * 1024 * 1024 + 1)), /过长/);
});

test('视频号转写会下载解密视频、提取音频并清理临时文件', async () => {
  let temporaryDirectory = '';
  const taskId = await createWechatTranscriptTask({
    url: 'https://video.example/encrypted.mp4',
    platform: 'wechat_channels',
    decodeKey: '123456',
  }, async (descriptor, inputPath) => {
    assert.equal(descriptor.decodeKey, '123456');
    temporaryDirectory = path.dirname(inputPath);
    await fs.writeFile(inputPath, Buffer.from('encrypted-video'));
  }, {
    runFfmpeg: async (inputPath, outputPath) => {
      assert.equal(await fs.readFile(inputPath, 'utf8'), 'encrypted-video');
      await fs.writeFile(outputPath, Buffer.from('voice-data'));
    },
    requestApi: async (action, params) => {
      assert.equal(action, 'CreateRecTask');
      assert.equal(params.SourceType, 1);
      assert.equal(Buffer.from(params.Data, 'base64').toString(), 'voice-data');
      return { Data: { TaskId: 24680 } };
    },
  });
  assert.equal(taskId, 24680);
  await assert.rejects(() => fs.access(temporaryDirectory));
});

test('小红书 HTTP 媒体先在后端提取音频，再以数据提交 ASR，不向 ASR 发送媒体直链', async () => {
  let temporaryDirectory = '';
  const taskId = await createXiaohongshuTranscriptTask({
    url: 'http://media.example/private.mp4', platform: 'xiaohongshu',
  }, async (descriptor, inputPath) => {
    assert.equal(descriptor.platform, 'xiaohongshu');
    assert.equal(descriptor.decodeKey, '');
    temporaryDirectory = path.dirname(inputPath);
    await fs.writeFile(inputPath, Buffer.from('video-data'));
  }, {
    runFfmpeg: async (inputPath, outputPath) => {
      assert.equal(await fs.readFile(inputPath, 'utf8'), 'video-data');
      await fs.writeFile(outputPath, Buffer.from('audio-data'));
    },
    requestApi: async (action, params) => {
      assert.equal(action, 'CreateRecTask');
      assert.equal(params.SourceType, 1);
      assert.equal(Object.hasOwn(params, 'Url'), false);
      assert.equal(Buffer.from(params.Data, 'base64').toString(), 'audio-data');
      return { Data: { TaskId: 24681 } };
    },
  });
  assert.equal(taskId, 24681);
  await assert.rejects(() => fs.access(temporaryDirectory));
});

test('优先组合分句结果并清理基础结果中的时间戳', () => {
  assert.equal(normalizeTranscript({
    Result: '[0:0.000,0:1.000] 不应使用',
    ResultDetail: [{ FinalSentence: '第一句话。' }, { FinalSentence: '第二句话！' }],
  }), '第一句话。\n第二句话！');
  assert.equal(normalizeTranscript({ Result: '[0:0.000,0:1.000] 你好。\n[0:1.000,0:2.000] 世界！' }), '你好。\n世界！');
});

test('查询任务会区分处理中、成功和失败状态', async () => {
  const pending = await getTranscriptTask(1, { requestApi: async () => ({ Data: { Status: 1 } }) });
  assert.deepEqual(pending, { status: 'pending' });

  const succeeded = await getTranscriptTask(2, {
    requestApi: async () => ({ Data: { Status: 2, ResultDetail: [{ FinalSentence: '转写成功。' }], AudioDuration: 12.5 } }),
  });
  assert.deepEqual(succeeded, { status: 'succeeded', transcript: '转写成功。', audioDurationSec: 12.5 });

  await assert.rejects(() => getTranscriptTask(3, { requestApi: async () => ({ Data: { Status: 3 } }) }), /识别失败/);
});

test('转写任务令牌可验证、会过期且不能篡改', () => {
  const now = 1700000000000;
  const token = createTranscriptToken(12345, { secret: 'test-secret', now });
  assert.equal(verifyTranscriptToken(token, { secret: 'test-secret', now: now + 1000 }), 12345);
  assert.throws(() => verifyTranscriptToken(`${token}x`, { secret: 'test-secret', now: now + 1000 }), /无效/);
  assert.throws(() => verifyTranscriptToken(token, { secret: 'test-secret', now: now + 3 * 60 * 60 * 1000 }), /过期/);
});
