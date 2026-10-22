import { expect, test, type Page } from '@playwright/test';

// 지구본 보드(기본 화면): 켜면 쓰기 모드 → 저장 → 정돈되면 제 주제로 돌아 고리에 붙는다

async function openGlobe(page: Page) {
  await page.goto('/?demo=1&reset=1');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
}

test('지구본: 켜면 쓰기 칸, 첫 키 입력이 바로 들어가고 Enter로 저장하면 쓰기 칸이 닫히고 제 주제 고리에 붙는다', async ({ page }) => {
  await openGlobe(page);
  const input = page.getByTestId('globe-composer-input');
  await expect(input).toBeVisible();
  // 하단 입력 바는 없다
  await expect(page.getByTestId('btn-write')).toHaveCount(0);

  await page.keyboard.type('새로 생긴 카페에서 커피 원두 사오기');
  await expect(input).toHaveValue('새로 생긴 카페에서 커피 원두 사오기');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('globe-composer')).toHaveCount(0);

  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '41', { timeout: 10_000 });
  const m = await page.evaluate(async () => {
    const { db } = (window as unknown as { __kk: { db: { memos: { toArray(): Promise<{ id: string; text: string; status: string; topicId: string }[]> } } } }).__kk;
    return (await db.memos.toArray()).find((x) => x.text.startsWith('새로 생긴 카페에서'))!;
  });
  expect(m.status).toBe('organized');

  // 그 주제가 정가운데로 돌아오고, 비행이 끝나면 고리 칸에 카드가 보인다
  await expect(page.getByTestId('board')).toHaveAttribute('data-front', m.topicId, { timeout: 5000 });
  await expect(page.getByTestId('board')).toHaveAttribute('data-mode', 'focus');
  const card = page.locator(`.g-cluster[data-topic-id="${m.topicId}"] [data-memo-id="${m.id}"]`);
  await expect(card).toHaveCount(1);
  await expect(card).not.toHaveClass(/g-incoming/, { timeout: 8000 });
  await expect(page.getByTestId('flight-card')).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByTestId('pending-card')).toHaveCount(0);

  // "새로 쓰기" 버튼은 없다. 정가운데 주제 옆 +로 쓰기 칸이 다시 열린다
  await expect(page.getByTestId('globe-write')).toHaveCount(0);
  await page.locator(`.g-cluster[data-topic-id="${m.topicId}"] [data-testid="topic-plus"]`).click();
  await expect(input).toBeVisible();
});

test('지구본: 흐린 지구본을 탭하면 저장 없이 닫히고, 쓰던 글은 다시 열 때 남아 있다', async ({ page }) => {
  await openGlobe(page);
  const input = page.getByTestId('globe-composer-input');
  await input.fill('아직 다 못 쓴 생각');
  await page.mouse.click(190, 740);
  await expect(page.getByTestId('globe-composer')).toHaveCount(0);
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  await expect(page.getByTestId('board')).toHaveAttribute('data-settled', '1');
  await page.locator('.g-cluster[data-lod="open"] [data-testid="topic-plus"]').click();
  await expect(input).toHaveValue('아직 다 못 쓴 생각');
});

test('지구본: 가운데 주제 옆 +를 누르면 쓰기 칸이 열리고, 쓴 메모는 그 주제에 붙는다(잠김)', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  const plus = page.locator('.g-cluster[data-lod="open"] [data-testid="topic-plus"]');
  await expect(plus).toHaveCount(1);
  await expect(plus).toBeVisible();
  const topicId = await plus.evaluate((el) => el.closest('[data-topic-id]')!.getAttribute('data-topic-id'));
  await plus.click();
  await expect(page.getByTestId('composer-topic')).toBeVisible();
  await page.getByTestId('globe-composer-input').fill('전혀 상관없는 주말 등산 계획');
  await page.getByTestId('globe-send').click();
  await expect(page.getByTestId('globe-composer')).toHaveCount(0);
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '41', { timeout: 10_000 });
  const m = await page.evaluate(async () => {
    const { db } = (window as unknown as { __kk: { db: { memos: { toArray(): Promise<{ text: string; topicId: string; topicLocked: boolean }[]> } } } }).__kk;
    return (await db.memos.toArray()).find((x) => x.text.startsWith('전혀 상관없는 주말'))!;
  });
  expect(m.topicId).toBe(topicId);
  expect(m.topicLocked).toBe(true);
});

test('지구본: 주제 없이 열린 쓰기 칸은 마지막으로 읽던(정면에 멈춘) 주제 색, 다시 켜도 기억한다', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  const first = await board.getAttribute('data-front');
  // 다른 주제로 돌린다
  await page.mouse.move(300, 400);
  await page.mouse.down();
  await page.mouse.move(120, 400, { steps: 8 });
  await page.mouse.up();
  await expect(board).toHaveAttribute('data-settled', '1');
  await expect.poll(() => board.getAttribute('data-front')).not.toBe(first);
  const front = (await board.getAttribute('data-front'))!;
  const color = await page.locator(`.g-cluster[data-topic-id="${front}"]`).evaluate((el) => (el as HTMLElement).style.getPropertyValue('--c'));
  await page.goto('/?demo=1');
  const composer = page.getByTestId('globe-composer');
  await expect(composer).toBeVisible();
  await expect(page.getByTestId('composer-topic')).toHaveCount(0);
  await expect.poll(() => composer.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--c'))).toBe(color);
});

test('지구본: 창 resize 이벤트 없이 보드 크기가 바뀌어도(iOS 웹뷰) 정가운데 주제가 화면 가운데에 온다', async ({ page }) => {
  // 휴대폰 웹뷰가 임시 크기로 먼저 그린 뒤 실제 크기를 받는데 resize 이벤트가 오지 않는 경우를 흉내 낸다
  await page.addInitScript(() => {
    const add = window.addEventListener;
    window.addEventListener = function (this: Window, type: string, ...rest: unknown[]) {
      if (type === 'resize') return;
      return (add as (...a: unknown[]) => void).call(this, type, ...rest);
    } as typeof window.addEventListener;
  });
  await page.setViewportSize({ width: 780, height: 640 });
  await page.goto('/?demo=1&reset=1&write=0');
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  await page.setViewportSize({ width: 375, height: 812 });
  const center = async () =>
    page.evaluate(() => {
      const front = document.querySelector<HTMLElement>('[data-testid=board]')!.dataset.front;
      const r = document.querySelector(`.g-cluster[data-topic-id="${front}"] .g-tag`)!.getBoundingClientRect();
      return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
    });
  await expect.poll(center).toEqual([188, 406]);
});

type MemoRow = { id: string; topicId: string; topicLocked?: boolean };
const memoOf = (page: Page, id: string) =>
  page.evaluate(async (mid) => {
    const { db } = (window as unknown as { __kk: { db: { memos: { get(id: string): Promise<MemoRow | undefined> } } } }).__kk;
    const m = await db.memos.get(mid);
    return m ? { topicId: m.topicId, topicLocked: !!m.topicLocked } : null;
  }, id);

/** 정가운데 주제의 첫 카드를 길게 눌러 들어 올린다 */
async function liftFrontCard(page: Page) {
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  const front = (await board.getAttribute('data-front'))!;
  const card = page.locator(`.g-cluster[data-topic-id="${front}"] [data-memo-id]`).first();
  const memoId = (await card.getAttribute('data-memo-id'))!;
  const b = (await card.locator('.card').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  const list = page.getByTestId('move-topics');
  await expect(list).toBeVisible();
  return { board, front, memoId, list };
}

test('지구본: 카드를 길게 누르면 오른쪽 위에 다른 주제 이름이 뜨고, 이름 위에 놓으면 그 주제로 옮겨져 고정된다', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  const { board, front, memoId, list } = await liftFrontCard(page);
  const before = (await memoOf(page, memoId))!;
  expect(before.topicId).toBe(front);
  // 오른쪽 위, 자기 주제는 목록에 없다
  const lb = (await list.boundingBox())!;
  expect(lb.x + lb.width).toBeGreaterThan(375 - 30);
  expect(lb.y).toBeLessThan(80);
  await expect(list.locator(`[data-move-topic="${front}"]`)).toHaveCount(0);
  await expect(page.getByTestId('lift-card')).toHaveCount(1);

  const row = list.locator('[data-move-topic]').nth(1);
  const target = (await row.getAttribute('data-move-topic'))!;
  const rb = (await row.boundingBox())!;
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 12 });
  await expect(row).toHaveClass(/over/);
  // 끄는 동안 지구본은 돌지 않는다
  expect(await board.getAttribute('data-front')).toBe(front);
  await page.mouse.up();

  await expect(list).toHaveCount(0);
  await expect.poll(() => memoOf(page, memoId)).toEqual({ topicId: target, topicLocked: true });
  // 새 주제로 돌아 그 고리에 내려앉는다
  await expect(board).toHaveAttribute('data-front', target, { timeout: 5000 });
  await expect(page.locator(`.g-cluster[data-topic-id="${front}"] [data-memo-id="${memoId}"]`)).toHaveCount(0);
  await expect(page.getByTestId('flight-card')).toHaveCount(0, { timeout: 8000 });
  await expect(page.getByTestId('lift-card')).toHaveCount(0);
});

test('지구본: 들어 올린 카드를 목록 밖에 놓으면 취소되고 주제는 그대로다', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  const { board, front, memoId, list } = await liftFrontCard(page);
  const before = (await memoOf(page, memoId))!;
  await page.mouse.move(80, 600, { steps: 8 });
  await expect(list.locator('.over')).toHaveCount(0);
  await page.mouse.up();
  await expect(list).toHaveCount(0);
  await expect(page.getByTestId('lift-card')).toHaveCount(0, { timeout: 2000 });
  expect(await memoOf(page, memoId)).toEqual(before);
  expect(await board.getAttribute('data-front')).toBe(front);
  // 원래 칸에 다시 보인다
  await expect(page.locator(`.g-cluster[data-topic-id="${front}"] [data-memo-id="${memoId}"]`)).not.toHaveClass(/g-lifted/);
  // 짧은 탭은 여전히 메모 상세를 연다
  await expect(board).toHaveAttribute('data-settled', '1');
  const b = (await page.locator(`[data-memo-id="${memoId}"] .card`).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.getByTestId('sheet-text')).toBeVisible();
  await expect(page.getByTestId('move-topics')).toHaveCount(0);
});
