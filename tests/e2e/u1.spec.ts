import { expect, test } from '@playwright/test';

// U1: iOS 홈 화면 앱 콜드 스타트에서 크기를 0으로 재도 NaN transform이 나오지 않고, 크기가 잡히면 resize 이벤트 없이도 복구된다

test.use({ viewport: { width: 390, height: 844 } });

test('콜드 스타트 크기 0 측정: NaN 없이 그리고, 0이 풀리면 이벤트 없이 정가운데로 복구된다', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __zero: boolean };
    w.__zero = true;
    const real = (proto: object, key: string) => Object.getOwnPropertyDescriptor(proto, key)!;
    for (const key of ['clientWidth', 'clientHeight']) {
      const d = real(Element.prototype, key);
      Object.defineProperty(Element.prototype, key, { configurable: true, get() { return w.__zero ? 0 : d.get!.call(this); } });
    }
    for (const key of ['innerWidth', 'innerHeight']) {
      const d = real(window, key);
      Object.defineProperty(window, key, { configurable: true, get() { return w.__zero ? 0 : d.get!.call(window); } });
    }
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const r = rect.call(this);
      return w.__zero ? new DOMRect(r.x, r.y, 0, 0) : r;
    };
    const vv = window.visualViewport;
    if (vv) {
      for (const key of ['width', 'height'] as const) {
        const d = real(Object.getPrototypeOf(vv), key);
        Object.defineProperty(vv, key, { configurable: true, get() { return w.__zero ? 0 : d.get!.call(vv); } });
      }
    }
  });
  await page.goto('/?demo=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  await page.waitForTimeout(500);
  // 0인 동안에도 NaN transform은 없다
  const during = await page.locator('.g-cluster').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform));
  expect(during.some((t) => t.includes('NaN'))).toBe(false);

  // resize 이벤트 없이 0만 푼다
  await page.evaluate(() => {
    (window as unknown as { __zero: boolean }).__zero = false;
  });
  await page.waitForTimeout(500);

  const board = page.getByTestId('board');
  const transforms = await page.locator('.g-cluster').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform));
  expect(transforms.length).toBeGreaterThan(0);
  for (const t of transforms) {
    expect(t).not.toBe('');
    expect(t).not.toContain('NaN');
  }
  const front = (await board.getAttribute('data-front'))!;
  expect(front).not.toBe('');
  const bb = (await board.boundingBox())!;
  const tb = (await page.locator(`.g-cluster[data-topic-id="${front}"] .g-tag`).boundingBox())!;
  // 펼친 주제 이름은 위쪽 제목 자리(D37): 가로 가운데, 위 safe-area(0) + 30
  expect(Math.abs(tb.x + tb.width / 2 - (bb.x + bb.width / 2))).toBeLessThan(10);
  expect(Math.abs(tb.y + tb.height / 2 - (bb.y + 30))).toBeLessThan(10);
});

test('메뉴: 진단 줄에 빌드 id와 크기가 보인다', async ({ page }) => {
  await page.goto('/?demo=1&write=0');
  await expect(page.getByTestId('board')).toHaveAttribute('data-settled', '1');
  const b = (await page.getByTestId('plus-button').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  const diag = page.getByTestId('menu-diag');
  await expect(diag).toContainText(/빌드 \S+/);
  await expect(diag).toContainText('엔진 390×');
  await expect(diag).not.toContainText('빌드 undefined');
});
