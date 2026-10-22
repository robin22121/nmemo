import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// 아래 가운데 "+" 길게 누르기 메뉴(Z4, D32): 내보내기·가져오기(Z3), 최근 7일 정돈 기록(Z5)

type KK = { __kk: { db: { memos: { update(id: string, p: object): Promise<number> } } } };

/** + 버튼을 길게 눌러(liftMs 450ms) 메뉴 판을 연다 */
async function openMenu(page: Page) {
  const b = (await page.getByTestId('plus-button').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId('menu-panel')).toBeVisible();
  await page.mouse.up();
}

/** 정가운데 주제의 카드 하나를 길게 눌러 다른 주제 이름 위에 놓는다(D23) */
async function moveFrontCard(page: Page, memoId: string) {
  const card = page.locator(`[data-memo-id="${memoId}"] .card`);
  const b = (await card.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  const list = page.getByTestId('move-topics');
  await expect(list).toBeVisible();
  const row = list.locator('[data-move-topic]').first();
  const rb = (await row.boundingBox())!;
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 12 });
  await expect(row).toHaveClass(/over/);
  await page.mouse.up();
  await expect(list).toHaveCount(0);
}

test('메뉴: + 길게 누르면 열리고, 정돈 기록이 있는 메모를 직접 옮기면 "직접 옮김"이 1 늘어난다', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  const front = (await board.getAttribute('data-front'))!;
  const ids = await page.locator(`.g-cluster[data-topic-id="${front}"] [data-memo-id]`).evaluateAll((els) => els.slice(0, 2).map((e) => e.getAttribute('data-memo-id')!));
  // 두 메모에 "방금 처음 정돈됨" 기록을 심는다(기존 데모 메모에는 없음)
  await page.evaluate(async (mids) => {
    const { db } = (window as unknown as KK).__kk;
    for (const id of mids) await db.memos.update(id, { organizedAt: Date.now() - 60_000 });
  }, ids);

  await openMenu(page);
  const stats = page.getByTestId('menu-stats');
  await expect(stats).toHaveText('최근 7일 정돈 2건 · 직접 옮김 0건(0%)');
  await expect(page.getByTestId('menu-panel')).toContainText('메신저');
  await page.mouse.click(20, 120); // 판 밖을 누르면 닫힘
  await expect(page.getByTestId('menu-panel')).toHaveCount(0);

  await moveFrontCard(page, ids[0]!);
  await expect(board).toHaveAttribute('data-settled', '1', { timeout: 8000 });
  await openMenu(page);
  await expect(stats).toHaveText('최근 7일 정돈 2건 · 직접 옮김 1건(50%)');
});

test('메뉴: 정돈 기록이 없으면 "—"', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await openMenu(page);
  await expect(page.getByTestId('menu-stats')).toHaveText('최근 7일 정돈 —');
});

test('메뉴: 내보내기는 파일을 내려받고(공유 불가 환경), 그 파일을 빈 DB에 가져오면 메모가 그대로 돌아온다', async ({ page }) => {
  // Chromium 경로: navigator.share가 없는 환경 → 내려받기
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }));
  await page.goto('/?demo=1&reset=1&write=0');
  const info = page.getByTestId('board-info');
  await expect(info).toHaveAttribute('data-cards', '40');
  const clusters = (await info.getAttribute('data-clusters'))!;

  await openMenu(page);
  const exp = page.getByTestId('menu-export');
  await expect(exp).toBeEnabled();
  await expect(page.getByTestId('menu-export-size')).toHaveText(/^약 \d+(\.\d)?(KB|MB)$/);
  const [download] = await Promise.all([page.waitForEvent('download'), exp.click()]);
  expect(download.suggestedFilename()).toMatch(/^끄적임-\d{8}-\d{4}\.json$/);
  const path = (await download.path())!;
  const file = JSON.parse(readFileSync(path, 'utf8'));
  expect(file.format).toBe('kkeujeogim-export');
  expect(file.memos).toHaveLength(40);
  await expect(page.getByTestId('toast-text')).toHaveText('내보냈어요');

  // 데모가 아닌 빈 DB(새 컨텍스트라 비어 있음)에 가져오기
  await page.goto('/?write=0');
  await expect(info).toHaveAttribute('data-cards', '0');
  await openMenu(page);
  await page.getByTestId('menu-import-input').setInputFiles(path);
  await expect(page.getByTestId('toast-text')).toContainText('메모 40개 추가');
  await expect(info).toHaveAttribute('data-cards', '40');
  await expect(info).toHaveAttribute('data-clusters', clusters);

  // 다시 가져오면 추가 0
  await openMenu(page);
  await page.getByTestId('menu-import-input').setInputFiles(path);
  await expect(page.getByTestId('toast-text')).toContainText('메모 0개 추가, 40개는 이미 있음');
  await expect(info).toHaveAttribute('data-cards', '40');
});

test('메뉴: 끄적임 파일이 아니면 분명한 말로 거절한다', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await openMenu(page);
  await page.getByTestId('menu-import-input').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByTestId('toast-text')).toHaveText('끄적임에서 내보낸 파일이 아니에요');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
});
