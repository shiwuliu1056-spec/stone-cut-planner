// 用现有 Playwright 安装检查独立预览；不依赖或启动业务服务。
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:8766/';
const results = [];
try {
  for (const [width, height] of [[375, 812], [390, 844], [430, 932]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const errors = [];
    const remoteRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => {
      if (!request.url().startsWith(new URL(url).origin) && !request.url().startsWith('data:')) remoteRequests.push(request.url());
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.tool-category, .entry-arrow').count(), 0, '不再显示分类或箭头');
    assert.deepEqual(await page.locator('.tool-number').allTextContents(), ['01', '02', '03'], '保留三个工具编号');
    assert.equal(await page.locator('.brand p').innerText(), '拥抱AI提高效率');
    await page.evaluate(() => {
      window.previewVibrations = [];
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: duration => {
        window.previewVibrations.push(duration);
        return true;
      } });
    });
    const metrics = await page.evaluate(() => {
      const rect = element => {
        const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
        return { x, y, width, height, right, bottom };
      };
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth,
        indicator: rect(document.querySelector('.home-indicator')),
        cards: [...document.querySelectorAll('.tool-card')].map(card => ({
          ...rect(card),
          copy: rect(card.querySelector('.tool-copy')),
          number: rect(card.querySelector('.tool-number')),
          name: rect(card.querySelector('.tool-name')),
          description: rect(card.querySelector('.tool-description')),
          scope: card.querySelector('.tool-scope') ? rect(card.querySelector('.tool-scope')) : null,
          art: rect(card.querySelector('.tool-art')),
        })),
      };
    });
    assert.equal(metrics.cards.length, 3);
    assert.ok(metrics.scrollWidth <= width, '不应横向溢出');
    for (const card of metrics.cards) {
      assert.equal(card.height, 148);
      assert.ok(card.bottom < metrics.indicator.y, '三个入口应在首屏安全区上方完整显示');
      assert.ok(card.copy.bottom < card.bottom - 10, '正文不应溢出卡片');
      assert.ok(card.copy.right + 9 <= card.art.x, '文字与插画应有独立间距');
      assert.ok(Math.abs(card.art.y + card.art.height / 2 - card.y - card.height / 2) < 1, '插画应上下居中');
      // 编号元素边界为20px内边距加1px边框；文字内部的1px padding不改变元素位置。
      assert.ok(Math.abs(card.number.y - card.y - 21) < 1, '编号应位于卡片左上角');
      assert.ok(card.number.right + 9 <= card.copy.x, '编号与文字应为独立列');
      assert.ok(Math.abs(card.copy.y + card.copy.height / 2 - card.y - card.height / 2) < 1, '文字组应在自身区域上下居中');
      assert.equal(card.name.x, card.description.x, '名称和说明应统一左对齐');
      if (card.scope) assert.equal(card.name.x, card.scope.x, '适用范围应和文字组左对齐');
    }
    await page.screenshot({ path: fileURLToPath(new URL(`./home-${width}.png`, import.meta.url)), fullPage: true });
    for (const button of await page.getByRole('button').all()) {
      const resting = await button.evaluate(element => getComputedStyle(element).backgroundColor);
      await button.hover();
      await page.mouse.down();
      const pressed = await button.evaluate(element => getComputedStyle(element).backgroundColor);
      assert.notEqual(pressed, resting, '按下须有即时视觉反馈');
      await page.mouse.up();
      assert.equal(page.url(), url, '入口尚未接入，不应导航');
    }
    assert.deepEqual(await page.evaluate(() => window.previewVibrations), [10, 10, 10], '三个入口各点击一次，均触发一次轻震动请求');
    await page.mouse.click(5, 250);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BUTTON');
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid');
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.previewVibrations), [10, 10, 10, 10], '键盘操作也应触发单次轻震动');
    await page.evaluate(() => Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined }));
    for (const button of await page.getByRole('button').all()) await button.click();
    assert.equal(page.url(), url, '不支持震动时也不应跳转或报错');
    assert.deepEqual(errors, []);
    assert.deepEqual(remoteRequests, []);
    results.push({ width, height, checks: '三列独立布局 / 编号左上角 / 文字组左对齐并垂直居中 / 图标垂直居中 / 无分类和箭头 / 首屏完整 / 按压与键盘焦点 / 三入口单次震动请求 / 无震动API正常 / 无远程请求 / 无浏览器错误' });
    await page.close();
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
