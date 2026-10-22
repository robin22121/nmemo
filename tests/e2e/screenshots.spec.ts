import { expect, test, type Page } from '@playwright/test';

// 점검용 스크린샷(375×812, 2x)을 docs/screenshots에 저장한다. 지구본 보드 기준.
const OUT = 'docs/screenshots';
const info = (page: Page) => page.getByTestId('board-info');

async function openDemo(page: Page, write = false) {
  await page.goto(write ? '/?demo=1&reset=1' : '/?demo=1&reset=1&write=0');
  await expect(info(page)).toHaveAttribute('data-cards', '40');
  await expect(page.getByTestId('board')).toHaveAttribute('data-settled', '1');
  await page.waitForTimeout(1200);
}

test('스크린샷: 집중(정면 주제 하나가 펼쳐진 보드)과 하늘(전체 주제)', async ({ page }) => {
  await openDemo(page);
  const board = page.getByTestId('board');
  if ((await board.getAttribute('data-mode')) !== 'focus') {
    const front = (await board.getAttribute('data-front'))!;
    await page.locator(`.g-cluster[data-topic-id="${front}"] .g-tag`).click();
    await expect(board).toHaveAttribute('data-mode', 'focus');
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: `${OUT}/01-board-demo.png` });
  const front = (await board.getAttribute('data-front'))!;
  await page.locator(`.g-cluster[data-topic-id="${front}"] .g-tag`).click();
  await expect(board).toHaveAttribute('data-mode', 'sky');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/02-board-overview.png` });
});

test('스크린샷: 메모장(메모 상세)', async ({ page }) => {
  await openDemo(page);
  const board = page.getByTestId('board');
  const front = (await board.getAttribute('data-front'))!;
  const memoId = (await page.locator(`.g-cluster[data-topic-id="${front}"] .g-card[data-memo-id]`).first().getAttribute('data-memo-id'))!;
  await page.locator(`.g-card[data-memo-id="${memoId}"] .face`).click();
  await expect(page.getByTestId('memo-sheet')).toBeVisible();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/05-memo-sheet.png` });
});

test('스크린샷: 쓰기 칸', async ({ page }) => {
  await page.goto('/?demo=1&reset=1');
  await expect(info(page)).toHaveAttribute('data-cards', '40');
  await page.getByTestId('globe-composer-input').fill('새로 생긴 카페에서 커피 원두 사오기');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/06-composer.png` });
});
