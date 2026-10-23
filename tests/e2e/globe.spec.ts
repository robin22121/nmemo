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

  // "새로 쓰기" 버튼은 없다. 아래 가운데 +로 쓰기 칸이 다시 열린다
  await expect(page.getByTestId('globe-write')).toHaveCount(0);
  await page.getByTestId('plus-button').click();
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
  await page.getByTestId('plus-button').click();
  await expect(input).toHaveValue('아직 다 못 쓴 생각');
});

test('지구본: 집중 상태에서 아래 +를 누르면 펼친 주제 칩이 달린 쓰기 칸이 열리고, 쓴 메모는 그 주제에 붙는다(잠김). 주제 옆 +는 없다', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  await expect(page.getByTestId('topic-plus')).toHaveCount(0);
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-mode', 'focus');
  const topicId = (await board.getAttribute('data-front'))!;
  const name = await page.locator(`.g-cluster[data-topic-id="${topicId}"] .g-tag`).innerText();
  await page.getByTestId('plus-button').click();
  await expect(page.getByTestId('composer-topic')).toContainText(name.trim());
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

test('지구본: 쓰기 칸의 주제 칩을 누르면 빠지고, 칩 없이 저장한 메모는 주제 고정이 아니다', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  await expect(page.getByTestId('board')).toHaveAttribute('data-mode', 'focus');
  await page.getByTestId('plus-button').click();
  await expect(page.getByTestId('composer-topic-chip')).toBeVisible();
  await page.getByTestId('composer-topic-chip').click();
  await expect(page.getByTestId('composer-topic')).toHaveCount(0);
  await page.getByTestId('globe-composer-input').fill('전혀 상관없는 주말 등산 계획');
  await page.getByTestId('globe-send').click();
  await expect(page.getByTestId('globe-composer')).toHaveCount(0);
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '41', { timeout: 10_000 });
  const m = await page.evaluate(async () => {
    const { db } = (window as unknown as { __kk: { db: { memos: { toArray(): Promise<{ text: string; topicLocked?: boolean }[]> } } } }).__kk;
    return (await db.memos.toArray()).find((x) => x.text.startsWith('전혀 상관없는 주말'))!;
  });
  expect(m.topicLocked).toBeFalsy();
});

test('지구본: 하늘 상태에서 아래 +를 누르면 주제 칩 없는 쓰기 칸이 열린다', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-mode', 'focus');
  const spot = await emptySpot(page);
  expect(spot).not.toBeNull();
  await page.mouse.click(spot!.x, spot!.y);
  await expect(board).toHaveAttribute('data-mode', 'sky');
  await page.getByTestId('plus-button').click();
  await expect(page.getByTestId('globe-composer')).toBeVisible();
  await expect(page.getByTestId('composer-topic')).toHaveCount(0);
});

test('지구본: 주제 없이 열린 쓰기 칸은 마지막으로 읽던(정면에 멈춘) 주제 색, 다시 켜도 기억한다', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  const first = await board.getAttribute('data-front');
  // 하늘 상태에서 다른 주제로 돌린다(집중 상태에서 끌면 뒤 구만 돌고 펼친 주제는 그대로, D35)
  await page.locator(`.g-cluster[data-topic-id="${first}"] .g-tag`).click();
  await expect(board).toHaveAttribute('data-mode', 'sky');
  await expect(board).toHaveAttribute('data-settled', '1');
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

/* eslint-disable @typescript-eslint/no-explicit-any */
type KkDb = { db: any };

/** 정가운데 주제의 첫 카드와, 다른 주제에 있는 메모 하나 */
async function frontAndOther(page: Page) {
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  const front = (await board.getAttribute('data-front'))!;
  const memoId = (await page.locator(`.g-cluster[data-topic-id="${front}"] [data-memo-id]`).first().getAttribute('data-memo-id'))!;
  const other = await page.evaluate(
    async (front) => {
      const db = (window as unknown as { __kk: KkDb }).__kk.db;
      const o = (await db.memos.toArray()).find((m: any) => m.status === 'organized' && m.topicId && m.topicId !== front);
      const ot = await db.topics.get(o.topicId);
      const ft = await db.topics.get(front);
      return { memoId: o.id as string, topicId: o.topicId as string, color: ot.color as string, name: ot.name as string, frontName: ft.name as string };
    },
    front,
  );
  return { board, front, memoId, other };
}

async function openSheetOf(page: Page, memoId: string, topicId: string) {
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  // 링크를 더하면 주제 자리가 다시 계산되어 정면이 바뀔 수 있다 → 그 주제 이름표를 눌러 정면으로
  if ((await board.getAttribute('data-front')) !== topicId) await page.locator(`.g-cluster[data-topic-id="${topicId}"] .g-tag`).click();
  await expect(board).toHaveAttribute('data-front', topicId);
  await expect(board).toHaveAttribute('data-settled', '1');
  // 배치가 바뀐 직후엔 카드가 이름표 자리에서 다시 펼쳐진다 → 자리가 멈추고 맨 위에 있을 때 누른다(Playwright 클릭 대기)
  await page.locator(`.g-card[data-memo-id="${memoId}"] .face`).click();
  await expect(page.getByTestId('memo-sheet')).toBeVisible();
  const text = await page.evaluate(async (id) => (await (window as unknown as { __kk: KkDb }).__kk.db.memos.get(id)).text as string, memoId);
  await expect(page.getByTestId('sheet-text')).toHaveText(text);
  // 연결·이동 기록은 카드 아래 연결 줄을 눌러 펼친다(F6)
  await page.getByTestId('focus-conn').click();
}

test('지구본: 고정 메모가 다른 주제 메모와 이어지면 카드에 그 주제 색 점, 상세에 연결된 주제가 보이고 누르면 그 주제로 돈다(D25)', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  const { board, front, memoId, other } = await frontAndOther(page);
  const card = page.locator(`.g-card[data-memo-id="${memoId}"]`);
  // 고정 전에는 링크가 있어도 배지가 없다
  await expect(card.getByTestId('card-conn')).toHaveCount(0);
  await page.evaluate(
    async ({ memoId, otherId }) => {
      const db = (window as unknown as { __kk: KkDb }).__kk.db;
      await db.memos.update(memoId, { topicLocked: true });
      const id = memoId < otherId ? `${memoId}|${otherId}` : `${otherId}|${memoId}`;
      await db.links.put({ id, fromId: memoId, toId: otherId, strength: 1, reason: '같은 동네 이야기' });
    },
    { memoId, otherId: other.memoId },
  );
  const dot = card.locator(`[data-testid="card-conn"] [data-conn-topic="${other.topicId}"]`);
  await expect(dot).toHaveCount(1);
  expect(await dot.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--dc'))).toBe(other.color);
  await expect(card.getByTestId('card-moved')).toHaveCount(0);

  await openSheetOf(page, memoId, front);
  const row = page.getByTestId('conn-list').locator(`[data-conn-topic="${other.topicId}"]`);
  await expect(row).toContainText(other.name);
  await expect(row).toContainText('같은 동네 이야기');
  await row.locator('.conn-head').click();
  await expect(page.getByTestId('memo-sheet')).toHaveCount(0);
  await expect(board).toHaveAttribute('data-front', other.topicId, { timeout: 5000 });
});

test('지구본: AI 이동 기록이 있으면 카드에 이력 표시, 상세에 최근 것부터, 되돌린 묶음은 안 보인다(D26)', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  const { front, memoId, other } = await frontAndOther(page);
  const second = (await page.locator(`.g-cluster[data-topic-id="${front}"] [data-memo-id]`).nth(1).getAttribute('data-memo-id'))!;
  await page.evaluate(
    async ({ memoId, second, front, from }) => {
      const db = (window as unknown as { __kk: KkDb }).__kk.db;
      const now = Date.now();
      const batch = (id: string, undone: boolean) => ({ id, topicId: front, at: now, prevName: '', prevSummary: '', prevCenterKeywords: [], newName: '', moveCount: 1, undone });
      await db.batches.bulkPut([batch('e2e-ok', false), batch('e2e-undone', true)]);
      await db.moves.bulkPut([
        { id: 'e2e-1', batchId: 'e2e-ok', memoId, fromTopicId: from, toTopicId: front, reason: '이쪽 이야기에 더 가까워요', at: now - 60_000 },
        { id: 'e2e-2', batchId: 'e2e-ok', memoId, fromTopicId: 'gone-topic', toTopicId: from, reason: '', at: now - 3_600_000 },
        { id: 'e2e-3', batchId: 'e2e-undone', memoId, fromTopicId: front, toTopicId: from, reason: '되돌린 이동', at: now },
        { id: 'e2e-4', batchId: 'e2e-undone', memoId: second, fromTopicId: from, toTopicId: front, reason: '되돌린 이동', at: now },
      ]);
    },
    { memoId, second, front, from: other.topicId },
  );
  await expect(page.locator(`.g-card[data-memo-id="${memoId}"] [data-testid="card-moved"]`)).toHaveCount(1);
  await expect(page.locator(`.g-card[data-memo-id="${second}"] [data-testid="card-moved"]`)).toHaveCount(0);
  // 고정 아닌 메모라 연결 배지는 없다
  await expect(page.locator(`.g-card[data-memo-id="${memoId}"] [data-testid="card-conn"]`)).toHaveCount(0);

  await openSheetOf(page, memoId, front);
  const items = page.getByTestId('move-list').locator('li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText(`· ${other.name} → ${other.frontName}`);
  await expect(items.nth(0)).toContainText('이쪽 이야기에 더 가까워요');
  await expect(items.nth(0)).toHaveText(/^\d+월 \d+일 \d{2}:\d{2} · /);
  await expect(items.nth(1)).toContainText(`· (사라진 주제) → ${other.name}`);
  await expect(page.getByTestId('move-list')).not.toContainText('되돌린 이동');
  await expect(page.getByTestId('conn-list')).toHaveCount(0);
});

test('지구본: 열기와 닫기는 대칭 — 하늘에서 주제를 누르면 집중, 정면 이름표나 빈 곳을 누르면 접혀 하늘(D29)', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  const front = (await board.getAttribute('data-front'))!;
  const tag = page.locator(`.g-cluster[data-topic-id="${front}"] .g-tag`);
  // 집중 → 정면 이름표 → 하늘
  if ((await board.getAttribute('data-mode')) !== 'focus') await tag.click();
  await expect(board).toHaveAttribute('data-mode', 'focus');
  await tag.click();
  await expect(board).toHaveAttribute('data-mode', 'sky');
  // 하늘 → 주제 → 집중
  await tag.click();
  await expect(board).toHaveAttribute('data-mode', 'focus');
  // 집중 → 빈 곳 → 하늘
  // 이름표·카드에서 멀리 떨어진 빈 곳을 찾아 누른다
  const spot = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('.g-tag, .g-card, [data-more]')].map((el) => el.getBoundingClientRect());
    for (let y = 60; y < innerHeight - 60; y += 15)
      for (let x = 30; x < innerWidth - 30; x += 15) {
        const far = rects.every((r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom)) > 24);
        if (far && document.elementFromPoint(x, y)?.closest('.g-stage, .g-board')) return { x, y };
      }
    return null;
  });
  expect(spot).not.toBeNull();
  await page.mouse.click(spot!.x, spot!.y);
  await expect(board).toHaveAttribute('data-mode', 'sky');
});

const emptySpot = (page: Page) =>
  page.evaluate(() => {
    const rects = [...document.querySelectorAll('.g-tag, .g-card, [data-more], [data-testid="plus-button"]')].map((el) => el.getBoundingClientRect());
    for (let y = 60; y < innerHeight - 60; y += 15)
      for (let x = 30; x < innerWidth - 30; x += 15) {
        const far = rects.every((r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom)) > 24);
        if (far && document.elementFromPoint(x, y)?.closest('.g-stage, .g-board')) return { x, y };
      }
    return null;
  });

test('지구본: 하늘 빈 곳 탭은 다시 정가운데 주제 펼치기(D32로 D30 취소)', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  const front = (await board.getAttribute('data-front'))!;
  const tag = page.locator(`.g-cluster[data-topic-id="${front}"] .g-tag`);
  if ((await board.getAttribute('data-mode')) !== 'focus') await tag.click();
  await expect(board).toHaveAttribute('data-mode', 'focus');
  await tag.click();
  await expect(board).toHaveAttribute('data-mode', 'sky');
  const spot = await emptySpot(page);
  expect(spot).not.toBeNull();
  await page.mouse.click(spot!.x, spot!.y);
  await expect(board).toHaveAttribute('data-mode', 'focus');
  await expect(page.getByTestId('globe-composer')).toHaveCount(0);
  // 집중 상태의 빈 곳 탭은 하늘로 접힘(D29)
  const spot2 = await emptySpot(page);
  await page.mouse.click(spot2!.x, spot2!.y);
  await expect(board).toHaveAttribute('data-mode', 'sky');
});

test('지구본: 아래 가운데 + 탭은 주제 없는 쓰기 창, 저장하면 주제·잠금 없는 대기 메모. 지구본은 그대로(D32)', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  // 하늘 상태에서 + = 주제 없음(집중 상태는 펼친 주제 칩, D33)
  const spot = await emptySpot(page);
  await page.mouse.click(spot!.x, spot!.y);
  await expect(board).toHaveAttribute('data-mode', 'sky');
  const mode = await board.getAttribute('data-mode');
  const plus = page.getByTestId('plus-button');
  const b = (await plus.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(Math.abs(b.x + b.width / 2 - vp.width / 2)).toBeLessThan(2);
  expect(b.y + b.height).toBeGreaterThan(vp.height - 90);
  await plus.click();
  await expect(page.getByTestId('globe-composer')).toBeVisible();
  await expect(page.getByTestId('composer-topic')).toHaveCount(0);
  await expect(page.getByTestId('plus-button')).toHaveCount(0);
  await page.getByTestId('globe-composer-input').fill('하늘에서 바로 적는 생각');
  await page.getByTestId('globe-send').click();
  await expect(page.getByTestId('globe-composer')).toHaveCount(0);
  const m = await page.evaluate(async () => {
    const { db } = (window as unknown as { __kk: { db: { memos: { toArray(): Promise<{ text: string; topicId?: string; topicLocked?: boolean }[]> } } } }).__kk;
    return (await db.memos.toArray()).find((x) => x.text.startsWith('하늘에서 바로'))!;
  });
  expect(m).toBeTruthy();
  expect(m.topicLocked).toBeFalsy();
  await expect(board).toHaveAttribute('data-mode', 'focus'); // 저장하면 집중(기존 동작). + 탭 자체는 모드를 바꾸지 않음
  expect(mode).toBeTruthy();
});

test('지구본: + 길게 누르면 메뉴 판(내보내기·가져오기·통계·진단), 밖을 누르면 닫힘. ⋯ 버튼은 없다(D32)', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board')).toHaveAttribute('data-settled', '1');
  await expect(page.getByTestId('menu-button')).toHaveCount(0);
  const board = page.getByTestId('board');
  const mode = await board.getAttribute('data-mode');
  const b = (await page.getByTestId('plus-button').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  const panel = page.getByTestId('menu-panel');
  await expect(panel).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId('globe-composer')).toHaveCount(0);
  await expect(page.getByTestId('menu-export')).toBeVisible();
  await expect(page.getByTestId('menu-import')).toBeVisible();
  await expect(page.getByTestId('menu-stats')).toBeVisible();
  await expect(page.getByTestId('menu-diag')).toBeVisible();
  const pb = (await panel.boundingBox())!;
  expect(pb.y + pb.height).toBeLessThanOrEqual(b.y);
  await page.mouse.click(20, 120);
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('plus-button')).toBeVisible();
  await expect(board).toHaveAttribute('data-mode', mode!);
});

// D31: 보드 자전. 하늘 상태는 전체가, 집중 상태는 정면 주제만 제자리고 배경 주제가 천천히 돈다. 만지면 멈췄다 4초 뒤 다시
async function openBoard(page: Page, mode: 'focus' | 'sky') {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  if ((await board.getAttribute('data-mode')) !== mode) await page.locator(`.g-cluster[data-topic-id="${await board.getAttribute('data-front')}"] .g-tag`).click();
  await expect(board).toHaveAttribute('data-mode', mode);
  return board;
}
const phiOf = async (board: ReturnType<Page['getByTestId']>) => Number(await board.getAttribute('data-phi'));
const transforms = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.g-cluster[data-topic-id]')].map((el) => [el.dataset.topicId!, el.style.transform] as const));

test('지구본: 하늘 상태에서는 손대지 않아도 천천히 자전하고, 만진 뒤에는 멈췄다가 몇 초 뒤 다시 돈다(D31)', async ({ page }) => {
  const board = await openBoard(page, 'sky');
  await page.waitForTimeout(4600); // 탭 직후 4초는 쉰다
  const a = await phiOf(board);
  await page.waitForTimeout(1500);
  const b = await phiOf(board);
  expect(Math.abs(b - a)).toBeGreaterThan(1.5);
  // 끌면 멈춘다(스냅이 끝난 뒤 값이 변하지 않는다)
  await page.mouse.move(200, 400);
  await page.mouse.down();
  await page.mouse.move(150, 400, { steps: 5 });
  await page.mouse.up();
  await expect(board).toHaveAttribute('data-settled', '1'); // D34 감속은 끝이 길어 시간 대신 멈춤을 기다린다
  const c = await phiOf(board);
  await page.waitForTimeout(1500);
  expect(await phiOf(board)).toBe(c);
  // 4초 넘게 가만히 두면 다시 돈다
  await page.waitForTimeout(4000);
  const d = await phiOf(board);
  await page.waitForTimeout(1000);
  expect(Math.abs((await phiOf(board)) - d)).toBeGreaterThan(0.5);
});

test('지구본: 집중 상태에서는 정면 주제와 펼친 카드는 제자리, 배경 주제만 천천히 돈다(D31)', async ({ page }) => {
  const board = await openBoard(page, 'focus');
  const front = (await board.getAttribute('data-front'))!;
  await page.waitForTimeout(4600);
  const t0 = await transforms(page);
  await page.waitForTimeout(1500);
  const t1 = await transforms(page);
  const at = (t: typeof t0, id: string) => t.find((x) => x[0] === id)![1];
  expect(at(t1, front)).toBe(at(t0, front));
  expect(t1.some(([id, tr]) => id !== front && tr !== at(t0, id))).toBe(true);
  await expect(board).toHaveAttribute('data-front', front);
  await expect(board).toHaveAttribute('data-settled', '1');
});

test('지구본: 밀고 손을 떼면 그 속도를 이어받아 줄곧 느려지며 정면 주제가 정가운데에 멈춘다(D34)', async ({ page }) => {
  const board = await openBoard(page, 'sky');
  // 프레임마다 그려진 φ와 그 프레임 시각, 손 뗀 시각을 모은다
  await page.evaluate(() => {
    const w = window as unknown as { tr: [number, number][]; mv: [number, number][]; up: number };
    const b = document.querySelector<HTMLElement>('[data-testid="board"]')!;
    w.tr = [];
    w.mv = [];
    b.addEventListener('pointermove', (e) => w.mv.push([performance.now(), e.clientX]), { capture: true });
    new MutationObserver(() => w.tr.push([document.timeline.currentTime as number, Number(b.dataset.phi)])).observe(b, { attributes: true, attributeFilter: ['data-phi'] });
    b.addEventListener('pointerup', () => (w.up = document.timeline.currentTime as number), { once: true, capture: true });
  });
  // 손가락처럼 고르게 민다(약 30ms마다 25px — 다음 주제까지 관성으로 갈 만큼 빠르게)
  await page.mouse.move(320, 400);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    if (i > 1) await page.waitForTimeout(16);
    await page.mouse.move(320 - i * 25, 400);
  }
  await page.mouse.up();
  await expect(board).toHaveAttribute('data-settled', '1');
  expect(Math.abs(Number(await board.getAttribute('data-delta')))).toBeLessThan(0.5);
  const { tr, mv, up } = await page.evaluate(() => {
    const w = window as unknown as { tr: [number, number][]; mv: [number, number][]; up: number };
    return { tr: w.tr, mv: w.mv, up: w.up };
  });
  // 프레임 시각이 고르지 않아(헤드리스) φ를 시각으로 보간해 50ms 구간 평균 속도(°/s)로 본다
  const phiAt = (t: number) => {
    const j = tr.findIndex((p) => p[0] >= t);
    if (j <= 0) return tr[Math.max(0, j)]![1];
    const [t0, p0] = tr[j - 1]!, [t1, p1] = tr[j]!;
    return t1 === t0 ? p1 : p0 + ((p1 - p0) * (t - t0)) / (t1 - t0);
  };
  // 손 뗄 때 손가락 속도: 마지막 100ms 이벤트의 x 기울기(최소제곱) × 0.16°/px(MOTION.degPerPx, D35)
  const w = mv.filter((p) => p[0] > mv[mv.length - 1]![0] - 100);
  const mt = w.reduce((a, p) => a + p[0], 0) / w.length, mx = w.reduce((a, p) => a + p[1], 0) / w.length;
  const slope = w.reduce((a, p) => a + (p[0] - mt) * (p[1] - mx), 0) / w.reduce((a, p) => a + (p[0] - mt) ** 2, 0);
  const vRel = -slope * 1000 * 0.16;
  expect(vRel).toBeGreaterThan(60);
  const end = tr[tr.length - 1]![0];
  // 헤드리스 프레임·입력 간격 흔들림을 덜려고 100ms 구간으로 본다(곡선 자체의 엄밀한 검사는 단위 테스트 glide.test.ts)
  const bins: number[] = [];
  for (let t = up; t + 100 <= end; t += 100) bins.push((phiAt(t + 100) - phiAt(t)) / 0.1);
  // 헤드리스가 프레임을 50ms 넘게 거른 구간은 엔진이 dt를 0.05초로 자르므로 그 구간 속도가 낮게 잡힌다 → 비교에서 뺀다
  const stalled = bins.map((_, i) => tr.some((p, j) => j > 0 && p[0] - tr[j - 1]![0] > 50 && p[0] > up + i * 100 && tr[j - 1]![0] < up + (i + 1) * 100));
  // 손 뗀 직후 속도가 0 근처로 떨어지지도, 튀어 오르지도 않는다
  expect(bins[0]!).toBeGreaterThan(vRel * 0.5);
  expect(bins[0]!).toBeLessThan(vRel * 1.6);
  // 이후 줄곧 느려진다 — 반대로 돌거나 다시 빨라지지 않고 0으로
  for (let i = 1; i < bins.length; i++) {
    expect(bins[i]!).toBeGreaterThan(-1);
    if (!stalled[i] && !stalled[i - 1]) expect(bins[i]!).toBeLessThan(bins[i - 1]! + vRel * 0.15);
  }
  expect(Math.abs(bins[bins.length - 1]!)).toBeLessThan(3);
});
