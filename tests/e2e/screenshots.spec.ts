import { expect, test, type Page } from '@playwright/test';

// 점검용 스크린샷(375×812, 2x)을 docs/screenshots에 저장한다.
const OUT = 'docs/screenshots';
const info = (page: Page) => page.getByTestId('board-info');

async function openDemo(page: Page) {
  await page.goto('/?globe=0&demo=1&reset=1');
  await expect(info(page)).toHaveAttribute('data-cards', '40');
  await page.waitForTimeout(1200);
}

test('스크린샷: 보드(데모)', async ({ page }) => {
  await openDemo(page);
  await page.screenshot({ path: `${OUT}/01-board-demo.png` });
  await page.getByTestId('overview-btn').click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/02-board-overview.png` });
});

test('스크린샷: 관련 메모 강조(누르고 있는 동안)', async ({ page }) => {
  await openDemo(page);
  const box = (await page.locator('[data-memo-id]', { hasText: '카페 쿠폰' }).first().boundingBox())!;
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(240); // 120ms 뒤 강조 시작(들어 올리기는 450ms)
  await page.screenshot({ path: `${OUT}/03-related-highlight.png` });
  await page.mouse.up();
});

test('스크린샷: 무리 상세', async ({ page }) => {
  await openDemo(page);
  await page.getByTestId('overview-btn').click();
  await page.waitForTimeout(1500);
  const label = (await page.locator('.cluster-label', { hasText: '제주 여행' }).boundingBox())!;
  await page.mouse.click(label.x + label.width / 2, label.y + label.height / 2);
  await expect(page.getByTestId('cluster-bar')).toBeVisible();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/04-cluster-detail.png` });
});

test('스크린샷: 메모 상세 시트', async ({ page }) => {
  await openDemo(page);
  const box = (await page.locator('[data-memo-id]', { hasText: '카페 쿠폰' }).first().boundingBox())!;
  await page.mouse.click(box.x, box.y);
  await expect(page.getByTestId('memo-sheet')).toBeVisible();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/05-memo-sheet.png` });
});

test('스크린샷: 저장 → 대기 → 비행', async ({ page }) => {
  await openDemo(page);
  await page.getByTestId('overview-btn').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('btn-write').click();
  await page.getByTestId('composer-input').fill('새로 생긴 카페에서 커피 원두 사오기');
  await page.screenshot({ path: `${OUT}/06-composer.png` });
  await page.getByTestId('composer-input').press('Enter');
  await expect(page.getByTestId('flight-card')).toBeAttached({ timeout: 8000 });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/07-flight.png` });
});
