import { expect, test, type Page } from '@playwright/test';

// 메모 포커스(2026-10-23 작업계획서 §4-1~4): 카드 자리에서 커져 정중앙, 같은 주제 메모 = 모양 위의 점, 밀어서 앞뒤, 빈 곳 탭으로 닫기.
// 수정·설정은 2026-10-22 메모장(E2~E7) 항목을 포커스 카드에서 그대로 확인한다.
test.use({ viewport: { width: 390, height: 844 } });
const W = 390;
const H = 844;

/* eslint-disable @typescript-eslint/no-explicit-any */
type KkDb = { db: any };
const memoOf = (page: Page, id: string) =>
  page.evaluate(async (mid) => {
    const db = (window as unknown as { __kk: KkDb }).__kk.db;
    const m = await db.memos.get(mid);
    const t = m?.topicId ? await db.topics.get(m.topicId) : undefined;
    return m ? { text: m.text as string, kind: m.kind, kindLocked: !!m.kindLocked, emotion: m.emotion?.label, emotionLocked: !!m.emotionLocked, done: !!m.done, topicId: m.topicId, topicName: t?.name, status: m.status } : null;
  }, id);

/** 주제 메모 id, 만든 순서 */
const orderOf = (page: Page, topicId: string) =>
  page.evaluate(async (tid) => {
    const db = (window as unknown as { __kk: KkDb }).__kk.db;
    return ((await db.memos.where('topicId').equals(tid).sortBy('createdAt')) as { id: string }[]).map((m) => m.id);
  }, topicId);

async function boot(page: Page) {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
}

/** 정면 주제의 첫 카드 */
async function frontCard(page: Page) {
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  const front = (await board.getAttribute('data-front'))!;
  const card = page.locator(`.g-cluster[data-topic-id="${front}"] .g-card[data-memo-id]`).first();
  const memoId = (await card.getAttribute('data-memo-id'))!;
  return { board, front, card, memoId };
}

/** 그 주제를 정면으로 */
async function toFront(page: Page, topicId: string) {
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  if ((await board.getAttribute('data-front')) !== topicId) await page.locator(`.g-cluster[data-topic-id="${topicId}"] .g-tag`).click();
  await expect(board).toHaveAttribute('data-front', topicId);
  await expect(board).toHaveAttribute('data-mode', 'focus');
  await expect(board).toHaveAttribute('data-settled', '1');
}

async function openFocus(page: Page, memoId: string) {
  await page.locator(`.g-card[data-memo-id="${memoId}"] .face`).click();
  const card = page.getByTestId('memo-sheet');
  await expect(page.getByTestId('memo-focus')).toHaveAttribute('data-phase', 'open');
  await expect(page.locator('.mp-ghost')).toHaveCount(0);
  return card;
}

const cardShown = (page: Page, memoId: string) =>
  page.locator(`.g-card[data-memo-id="${memoId}"]`).evaluate((el) => (el as HTMLElement).style.visibility !== 'hidden' && getComputedStyle(el.querySelector('.card')!).display !== 'none');

/** 빈 곳(카드·점에서 먼 오른쪽 아래 구석 근처) 탭 */
async function tapEmpty(page: Page) {
  await rested(page);
  const dots = await page.getByTestId('focus-dot').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((b) => [b.left + b.width / 2, b.top + b.height / 2]));
  const cands: [number, number][] = [[W / 2, H - 60], [30, 40], [W - 30, 40], [30, H - 60], [W - 30, H - 60], [W / 2, 30]];
  const p = cands.find(([x, y]) => dots.every(([dx, dy]) => Math.hypot(dx! - x, dy! - y) > 30))!;
  await page.mouse.click(p[0], p[1]);
}

/** 넘기기 드러내기(F10)가 끝나 큰 카드로 돌아올 때까지 */
const rested = (page: Page) => expect(page.getByTestId('memo-focus')).not.toHaveAttribute('data-revealed', '1');

async function swipe(page: Page, dx: number, y = H - 70) {
  const x0 = W / 2 - dx / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + (dx * i) / 8, y);
  await page.mouse.up();
}

test('포커스: 누른 카드 자리에서 커져 화면 정중앙, 폭 = 화면 − 68, 긴 글은 카드 안에서 스크롤(§4-1)', async ({ page }) => {
  await boot(page);
  const { card, memoId } = await frontCard(page);
  const long = Array.from({ length: 30 }, (_, i) => `${i + 1}번째 줄, 오늘 떠오른 생각을 길게 적어 둔다.`).join('\n');
  await page.evaluate(async ({ id, long }) => (window as unknown as { __kk: KkDb }).__kk.db.memos.update(id, { text: long }), { id: memoId, long });
  await expect(page.getByTestId('board')).toHaveAttribute('data-settled', '1');
  const before = (await card.locator('.card').boundingBox())!;
  const focus = await openFocus(page, memoId);

  // 시작 사각형 = 탭 전 카드 사각형(±6px)
  const from = (await focus.getAttribute('data-flip-from'))!.split(',').map(Number);
  [before.x, before.y, before.width, before.height].forEach((v, i) => expect(Math.abs(from[i]! - v)).toBeLessThanOrEqual(6));
  expect(await cardShown(page, memoId)).toBe(false);

  const b = (await focus.boundingBox())!;
  expect(Math.abs(b.x + b.width / 2 - W / 2)).toBeLessThanOrEqual(8);
  expect(Math.abs(b.y + b.height / 2 - H / 2)).toBeLessThanOrEqual(8);
  expect(Math.abs(b.width - (W - 68))).toBeLessThanOrEqual(2);
  expect(b.height).toBeLessThanOrEqual(H * 0.42);
  // 넘치는 글은 카드 안에서 스크롤된다
  const sc = await focus.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(sc.sh).toBeGreaterThan(sc.ch);
  await focus.evaluate((el) => (el.scrollTop = 400));
  expect(await focus.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  // 머리글 문구 없음(F5): 주제 이름이 포커스 화면 어디에도 없다
  const topicName = (await memoOf(page, memoId))!.topicName!;
  await expect(page.getByTestId('memo-focus')).not.toContainText(topicName);
  await expect(focus).toBeFocused();
});

test('포커스: 같은 주제 메모 = 점(카드 밖·화면 안·간격 ≥ 26), 밀기로 앞뒤, 점 탭으로 그 메모(§4-2)', async ({ page }) => {
  await boot(page);
  const { front, memoId } = await frontCard(page);
  const order = await orderOf(page, front);
  expect(order.length).toBeGreaterThanOrEqual(3);
  await page.evaluate(async (tid) => (window as unknown as { __kk: KkDb }).__kk.db.topics.update(tid, { shape: 'heart', shapeReason: '설레는 마음이 이어진 모양' }), front);
  const focus = await openFocus(page, memoId);
  const dots = page.getByTestId('focus-dot');
  await expect(dots).toHaveCount(Math.min(24, order.length));
  await expect(page.getByTestId('focus-dust')).toHaveAttribute('data-shape', 'heart');
  expect(await page.locator('[data-testid="focus-dust"] path').getAttribute('d')).toMatch(/^M/);
  await expect(page.getByTestId('focus-reason')).toHaveText('설레는 마음이 이어진 모양');

  // 점의 보이는 동그라미: 카드·이유 줄과 겹치지 않고 화면 가장자리 ≥ 12px, 점끼리 중심 거리 ≥ 26
  const card = (await focus.boundingBox())!;
  const reason = (await page.getByTestId('focus-reason').boundingBox())!;
  const rs = await dots.evaluateAll((els) => els.map((e) => e.querySelector('i')!.getBoundingClientRect().toJSON() as DOMRect));
  const hit = (a: DOMRect, b: { x: number; y: number; width: number; height: number }) => a.left < b.x + b.width && a.right > b.x && a.top < b.y + b.height && a.bottom > b.y;
  for (const r of rs) {
    expect(hit(r, card)).toBe(false);
    expect(hit(r, reason)).toBe(false);
    expect(r.left).toBeGreaterThanOrEqual(12 - 4); // 커진 점(scale 1.8)은 반지름이 4.8px 늘어난다
    expect(r.top).toBeGreaterThanOrEqual(12 - 4);
    expect(r.right).toBeLessThanOrEqual(W - 12 + 4);
    expect(r.bottom).toBeLessThanOrEqual(H - 12 + 4);
  }
  const cs = rs.map((r) => [r.left + r.width / 2, r.top + r.height / 2] as const);
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) expect(Math.hypot(cs[i]![0] - cs[j]![0], cs[i]![1] - cs[j]![1])).toBeGreaterThanOrEqual(26 - 0.5);

  // 처음 점 = 지금 메모
  await expect(page.locator('[data-testid="focus-dot"][data-on="1"]')).toHaveAttribute('data-memo-id', memoId);
  // 다른 점을 누르면(누르는 영역 36px 안, 중심에서 비켜서) 그 메모로 바뀌고 그 점이 커진다
  const target = order.find((id) => id !== memoId)!;
  const tDot = page.locator(`[data-testid="focus-dot"][data-memo-id="${target}"]`);
  const small = (await tDot.locator('i').boundingBox())!;
  const tb = (await tDot.boundingBox())!;
  await page.mouse.click(tb.x + tb.width / 2 + 9, tb.y + tb.height / 2 + 5);
  await expect(focus).toHaveAttribute('data-focus-memo', target);
  await expect(tDot).toHaveAttribute('data-on', '1');
  await expect.poll(async () => (await tDot.locator('i').boundingBox())!.width).toBeGreaterThan(small.width * 1.5);
  // 맨 처음 메모로 옮겨 두고 앞뒤를 본다
  await rested(page);
  if (target !== order[0]) await page.locator(`[data-testid="focus-dot"][data-memo-id="${order[0]}"]`).click({ force: true });
  await expect(focus).toHaveAttribute('data-focus-memo', order[0]!);
  // 손가락 왼쪽 → 다음(오름차순), 오른쪽 → 이전
  await swipe(page, -80);
  await expect(focus).toHaveAttribute('data-focus-memo', order[1]!);
  await expect(page.getByTestId('focus-bar')).toHaveAttribute('data-index', '1');
  // 카드 위에서 밀어도 같다
  await swipe(page, -80, H / 2);
  await expect(focus).toHaveAttribute('data-focus-memo', order[2]!);
  await swipe(page, 80);
  await expect(focus).toHaveAttribute('data-focus-memo', order[1]!);
  // 세로로 조금 움직인 건 밀기 아님
  await page.mouse.move(W / 2, H - 140);
  await page.mouse.down();
  await page.mouse.move(W / 2 + 30, H - 60, { steps: 6 });
  await page.mouse.up();
  await expect(focus).toHaveAttribute('data-focus-memo', order[1]!);
  // 마지막에서 다음 = 처음으로 돈다
  const lastId = order[order.length - 1]!;
  await rested(page);
  await page.locator(`[data-testid="focus-dot"][data-memo-id="${lastId}"]`).click({ force: true });
  await expect(focus).toHaveAttribute('data-focus-memo', lastId);
  await rested(page);
  await swipe(page, -80);
  await expect(focus).toHaveAttribute('data-focus-memo', order[0]!);
  await expect(page.getByTestId('focus-bar')).toHaveAttribute('data-index', '0');
  // 처음에서 이전 = 마지막으로 돈다
  await rested(page);
  await swipe(page, 80);
  await expect(focus).toHaveAttribute('data-focus-memo', lastId);
  await expect(page.getByTestId('focus-bar')).toHaveAttribute('data-index', String(order.length - 1));
  // 화살표 키도 돈다
  await rested(page);
  await page.keyboard.press('ArrowRight');
  await expect(focus).toHaveAttribute('data-focus-memo', order[0]!);
  await rested(page);
  await page.keyboard.press('ArrowLeft');
  await expect(focus).toHaveAttribute('data-focus-memo', lastId);
  await expect(page.getByTestId('memo-focus')).toHaveAttribute('data-phase', 'open');
});

test('포커스: 밀기 시작하면 카드가 작게 흐려지고 모양이 화면 가득 드러나며, 멈추면 다음 메모 카드가 정중앙 제 크기로(F10)', async ({ page }) => {
  await boot(page);
  const { front, memoId } = await frontCard(page);
  const order = await orderOf(page, front);
  expect(order.length).toBeGreaterThanOrEqual(3);
  await page.evaluate(async (tid) => (window as unknown as { __kk: KkDb }).__kk.db.topics.update(tid, { shape: 'footprints' }), front);
  const focus = await openFocus(page, memoId);
  const root = page.getByTestId('memo-focus');
  const opacityOf = (id: string) => page.getByTestId(id).evaluate((e) => Number(getComputedStyle(e).opacity));
  // 쉴 때: 큰 카드, 옅은 먼지만, 진한 먼지·빛은 안 보임
  await expect(root).not.toHaveAttribute('data-revealed', '1');
  expect(await opacityOf('focus-dust-full')).toBeLessThan(0.05);
  expect(await opacityOf('focus-dust')).toBeGreaterThan(0.95);

  const i = order.indexOf(memoId);
  const delta = i < order.length - 1 ? 1 : -1;
  const target = order[i + delta]!;
  const dx = delta === 1 ? -90 : 90;
  const x0 = W / 2 - dx / 2;
  const y = H - 70;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  // 끄는 거리만큼 드러난다(60px에 다)
  for (let k = 1; k <= 3; k++) await page.mouse.move(x0 + (dx * k) / 9, y);
  const half = (await focus.boundingBox())!.width / (W - 68);
  expect(half).toBeLessThan(0.95);
  expect(half).toBeGreaterThan(0.5);
  for (let k = 4; k <= 9; k++) await page.mouse.move(x0 + (dx * k) / 9, y);
  // 밀고 있는 동안: 카드 배율 < 0.6, 진한 먼지가 보이고 옅은 먼지는 사라지며, 갈 점이 빛난다
  const mid = (await focus.boundingBox())!;
  expect(mid.width / (W - 68)).toBeLessThan(0.6);
  expect(await focus.evaluate((e) => Number(getComputedStyle(e.parentElement!).opacity))).toBeLessThan(0.3);
  expect(await opacityOf('focus-dust-full')).toBeGreaterThan(0.9);
  expect(await opacityOf('focus-dust')).toBeLessThan(0.1);
  await expect(page.locator(`[data-testid="focus-dot"][data-memo-id="${target}"]`)).toHaveAttribute('data-aim', '1');
  expect(await opacityOf('focus-halo')).toBeGreaterThan(0.9);
  // 드러난 모양은 비율 그대로 화면 폭 거의 가득(먼지 상자 폭 ≥ 화면 폭의 60%)
  const dustBox = await page.locator('[data-testid="focus-dust-full"] path').evaluate((e) => ({ width: (e as SVGGraphicsElement).getBBox().width }));
  expect(dustBox.width).toBeGreaterThan(W * 0.6);
  await page.mouse.up();

  // 멈추면: 그 메모로 바뀌고 카드가 정중앙 제 크기로(±8), 빛은 그 점 자리로
  await expect(focus).toHaveAttribute('data-focus-memo', target);
  await rested(page);
  const b = (await focus.boundingBox())!;
  expect(Math.abs(b.width - (W - 68))).toBeLessThanOrEqual(2);
  expect(Math.abs(b.x + b.width / 2 - W / 2)).toBeLessThanOrEqual(8);
  expect(Math.abs(b.y + b.height / 2 - H / 2)).toBeLessThanOrEqual(8);
  expect(await opacityOf('focus-dust-full')).toBeLessThan(0.05);
  await expect(page.locator('[data-testid="focus-dot"][data-on="1"]')).toHaveAttribute('data-memo-id', target);

  // 조금만 끌고 놓으면(넘기지 않음) 되돌아온다
  await page.mouse.move(W / 2, y);
  await page.mouse.down();
  for (let k = 1; k <= 4; k++) await page.mouse.move(W / 2 + (25 * k) / 4, y);
  expect((await focus.boundingBox())!.width / (W - 68)).toBeLessThan(0.9);
  await page.mouse.up();
  await rested(page);
  await expect(focus).toHaveAttribute('data-focus-memo', target);
  expect(Math.abs((await focus.boundingBox())!.width - (W - 68))).toBeLessThanOrEqual(2);
});

test('포커스: 덮개가 진하고 펼친 주제의 지구본 카드는 포커스 동안 숨으며, 닫으면 다시 보인다(F10)', async ({ page }) => {
  await boot(page);
  const { front, memoId } = await frontCard(page);
  const cards = page.locator(`.g-cluster[data-topic-id="${front}"] .g-card[data-memo-id]`);
  const visibilities = () => cards.evaluateAll((els) => els.map((e) => getComputedStyle(e).visibility));
  expect(await visibilities()).toContain('visible');
  await openFocus(page, memoId);
  await expect.poll(async () => (await visibilities()).filter((v) => v !== 'hidden').length).toBe(0);
  const bg = await page.locator('.mp-backdrop').evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(Number(bg.match(/rgba?\([^)]*,\s*([\d.]+)\)/)![1])).toBeGreaterThanOrEqual(0.8);
  // 다른 주제의 카드는 숨기지 않는다(흐릿하게 계속 돈다)
  const others = await page.locator(`.g-cluster:not([data-topic-id="${front}"])`).evaluateAll((els) => els.map((e) => getComputedStyle(e).visibility));
  expect(others.every((v) => v === 'visible')).toBe(true);
  await tapEmpty(page);
  await expect(page.getByTestId('memo-focus')).toHaveCount(0);
  await expect.poll(async () => (await visibilities()).every((v) => v === 'visible')).toBe(true);
});

/** 정면 주제에 메모를 keep개만 남기고 나머지는 다른 주제로 옮긴다 → 남은 메모 id(만든 순서) */
async function keepOnly(page: Page, front: string, keep: number) {
  const order = await orderOf(page, front);
  await page.evaluate(
    async ({ front, ids }) => {
      const db = (window as unknown as { __kk: KkDb }).__kk.db;
      const to = (await db.topics.toArray()).find((t: any) => t.id !== front).id;
      for (const id of ids) await db.memos.update(id, { topicId: to, topicLocked: true });
    },
    { front, ids: order.slice(keep) },
  );
  await expect(page.locator(`.g-cluster[data-topic-id="${front}"] .g-card[data-memo-id]`)).toHaveCount(keep);
  await toFront(page, front);
  return order.slice(0, keep);
}

test('포커스: 메모 1개 주제 = 점 0개, 2개 = 점 2개(§4-2)', async ({ page }) => {
  await boot(page);
  const { front } = await frontCard(page);
  const [a, b] = await keepOnly(page, front, 2);
  await openFocus(page, a!);
  await expect(page.getByTestId('focus-dot')).toHaveCount(2);
  await expect(page.getByTestId('focus-dust')).toHaveCount(0);
  // 2개: 다음·이전 모두 다른 하나로
  await swipe(page, -80);
  await expect(page.getByTestId('memo-sheet')).toHaveAttribute('data-focus-memo', b!);
  await rested(page);
  await swipe(page, -80);
  await expect(page.getByTestId('memo-sheet')).toHaveAttribute('data-focus-memo', a!);
  await rested(page);
  await swipe(page, 80);
  await expect(page.getByTestId('memo-sheet')).toHaveAttribute('data-focus-memo', b!);
  await rested(page);
  await tapEmpty(page);
  await expect(page.getByTestId('memo-focus')).toHaveCount(0);

  await keepOnly(page, front, 1);
  await expect(page.locator(`.g-card[data-memo-id="${b}"]`)).toHaveCount(1);
  await openFocus(page, a!);
  await expect(page.getByTestId('focus-dot')).toHaveCount(0);
  await expect(page.getByTestId('focus-bar')).toHaveCount(0);
  // 1개: 밀어도 그대로(자기 자신으로 돌지 않는다)
  await swipe(page, -80);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('memo-sheet')).toHaveAttribute('data-focus-memo', a!);
  await expect(page.getByTestId('memo-focus')).not.toHaveAttribute('data-revealed', '1');
});

test('포커스: 빈 곳 탭 → 마지막으로 본 메모 카드 자리로 줄어들고, 포커스 중에도 배경 주제는 돈다(§4-3)', async ({ page }) => {
  await boot(page);
  const { front, memoId } = await frontCard(page);
  const order = await orderOf(page, front);
  const next = order[order.indexOf(memoId) + 1] ?? order[order.indexOf(memoId) - 1]!;
  const nextCard = page.locator(`.g-card[data-memo-id="${next}"] .card`);
  const before = (await nextCard.boundingBox())!;
  await openFocus(page, memoId);

  // 배경 주제(정면이 아닌 무리)의 transform이 1.5초 사이 바뀐다(손 뗀 뒤 자전 재개 4초 + 여유)
  await page.waitForTimeout(4500);
  const bgT = () => page.evaluate((f) => [...document.querySelectorAll<HTMLElement>(`.g-cluster:not([data-topic-id="${f}"])`)].map((e) => e.style.transform).join('|'), front);
  const t0 = await bgT();
  await page.waitForTimeout(1500);
  expect(await bgT()).not.toBe(t0);

  // 다른 메모로 옮긴 뒤 닫는다 → 그 메모 카드가 원래 자리(±2)로, 불투명
  await page.locator(`[data-testid="focus-dot"][data-memo-id="${next}"]`).click({ force: true });
  await expect(page.getByTestId('memo-sheet')).toHaveAttribute('data-focus-memo', next);
  await expect.poll(() => cardShown(page, memoId)).toBe(true);
  await tapEmpty(page);
  await expect(page.getByTestId('memo-focus')).toHaveCount(0);
  await expect(page.locator('.mp-ghost')).toHaveCount(0);
  await expect.poll(() => cardShown(page, next)).toBe(true);
  const after = (await nextCard.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(2);
  expect(await nextCard.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
});

test('포커스: 삭제하면 다음 메모로, 마지막이면 이전, 남은 게 없으면 닫힌다(§4-3·F6)', async ({ page }) => {
  await boot(page);
  const { front } = await frontCard(page);
  const [a, b, c] = await keepOnly(page, front, 3);
  const focus = await openFocus(page, b!);
  const del = async () => {
    await page.getByTestId('focus-more').click();
    await page.getByTestId('delete-memo').click();
    await page.getByTestId('confirm-delete').click();
  };
  await del();
  await expect(focus).toHaveAttribute('data-focus-memo', c!);
  expect(await memoOf(page, b!)).toBeNull();
  await del();
  await expect(focus).toHaveAttribute('data-focus-memo', a!);
  await del();
  await expect(page.getByTestId('memo-focus')).toHaveCount(0);
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '37');
});

test('포커스: 동작 줄이기에서도 열고 닫힌다(흐려지며)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page);
  const { memoId } = await frontCard(page);
  await openFocus(page, memoId);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('memo-focus')).toHaveCount(0);
  await expect.poll(() => cardShown(page, memoId)).toBe(true);
});

test('포커스: 글을 고쳐 저장하면 새로고침 뒤에도 남고, 빈 글은 저장하지 않으며, 사진 메모는 설명을 비울 수 있다. 고치는 중엔 점이 숨는다(§4-4)', async ({ page }) => {
  await boot(page);
  const { front, memoId } = await frontCard(page);
  const second = (await page.locator(`.g-cluster[data-topic-id="${front}"] .g-card[data-memo-id]`).nth(1).getAttribute('data-memo-id'))!;
  const original = (await memoOf(page, memoId))!.text;

  await openFocus(page, memoId);
  await expect(page.getByTestId('focus-dot').first()).toBeVisible();
  await page.getByTestId('edit-text').click();
  const edit = page.getByTestId('sheet-edit');
  await expect(edit).toBeFocused();
  // 고치는 중: 점·먼지 숨김, 카드 아래 끝이 보이는 화면 안
  await expect(page.getByTestId('focus-dot')).toHaveCount(0);
  await expect(page.getByTestId('focus-dust')).toHaveCount(0);
  const vb = await page.getByTestId('memo-sheet').evaluate((el) => ({ bottom: el.getBoundingClientRect().bottom, vv: (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? innerHeight) }));
  expect(vb.bottom).toBeLessThanOrEqual(vb.vv);
  await edit.fill('고친 메모 글입니다');
  await page.getByTestId('edit-done').click();
  await expect(page.getByTestId('sheet-text')).toHaveText('고친 메모 글입니다');
  await expect(page.getByTestId('focus-dot').first()).toBeVisible();
  // 다시 정돈되어도 주제는 그대로(E3)
  await expect.poll(async () => (await memoOf(page, memoId))!.status, { timeout: 10_000 }).toBe('organized');
  expect((await memoOf(page, memoId))!.topicId).toBe(front);

  // 빈 글로 저장하면 원래 글 유지
  await page.getByTestId('edit-text').click();
  await edit.fill('   ');
  await page.getByTestId('edit-done').click();
  await expect(page.getByTestId('toast-text')).toHaveText('빈 메모는 저장하지 않았어요');
  await expect(page.getByTestId('sheet-text')).toHaveText('고친 메모 글입니다');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('memo-focus')).toHaveCount(0);

  // 사진 메모: 설명을 비워 저장
  await page.evaluate(async (id) => {
    const db = (window as unknown as { __kk: KkDb }).__kk.db;
    const p = (await db.memos.toArray()).find((m: any) => m.input === 'photo' && m.photo);
    await db.memos.update(id, { input: 'photo', photo: p.photo, text: '사진 설명' });
  }, second);
  await expect(page.locator(`.g-card[data-memo-id="${second}"] .face[data-kind="photo"]`)).toHaveCount(1);
  await openFocus(page, second);
  await page.getByTestId('edit-text').click();
  await edit.fill('');
  await page.getByTestId('edit-done').click();
  await expect(page.getByTestId('sheet-text')).toHaveCount(0);
  await expect.poll(async () => (await memoOf(page, second))!.status, { timeout: 10_000 }).toBe('organized');

  await page.goto('/?demo=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  expect((await memoOf(page, memoId))!.text).toBe('고친 메모 글입니다');
  expect((await memoOf(page, second))!.text).toBe('');
  expect(original).not.toBe('고친 메모 글입니다');
});

test('포커스: 종류·감정·완료·주제 바꾸기(닫히고 그 주제로)·새 주제가 저장되고 새로고침 뒤에도 남는다(§4-4)', async ({ page }) => {
  await boot(page);
  const { board, front, memoId } = await frontCard(page);
  await openFocus(page, memoId);

  await page.getByTestId('kind-chip').click();
  await page.getByTestId('kind-opt-todo').click();
  await expect(page.getByTestId('kind-chip')).toHaveText('할 일');
  await page.getByTestId('emotion-chip').click();
  await page.getByTestId('emotion-opt-설렘').click();
  await expect(page.getByTestId('emotion-chip')).toHaveText('설렘');
  await page.getByTestId('todo-toggle').click();
  await expect(page.getByTestId('todo-toggle')).toHaveAttribute('aria-pressed', 'true');

  // 다른 주제로 옮기면 포커스가 닫히고 지구본이 그 주제로 돈다
  const other = await page.evaluate(async (f) => {
    const db = (window as unknown as { __kk: KkDb }).__kk.db;
    const t = (await db.topics.toArray()).find((t: any) => t.id !== f);
    return { id: t.id as string, name: t.name as string };
  }, front);
  await page.getByTestId('focus-more').click();
  await page.getByTestId('change-topic').click();
  await page.getByTestId('topic-pick').getByRole('button', { name: other.name }).click();
  await expect(page.getByTestId('memo-focus')).toHaveCount(0);
  await expect(board).toHaveAttribute('data-front', other.id, { timeout: 5000 });
  expect((await memoOf(page, memoId))!.topicId).toBe(other.id);

  // 새 주제 만들기
  await toFront(page, other.id);
  await openFocus(page, memoId);
  await page.getByTestId('focus-more').click();
  await page.getByTestId('change-topic').click();
  await page.getByLabel('새 주제 이름').fill('메모장 새 주제');
  await page.getByRole('button', { name: '만들기' }).click();
  await expect(page.getByTestId('memo-focus')).toHaveCount(0);
  await expect.poll(async () => (await memoOf(page, memoId))!.topicName).toBe('메모장 새 주제');

  await page.goto('/?demo=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  expect(await memoOf(page, memoId)).toMatchObject({ kind: 'todo', kindLocked: true, emotion: '설렘', emotionLocked: true, done: true, topicName: '메모장 새 주제' });
});

test('포커스: 다른 주제와 이어지면 카드 아래 "↗ 주제와 이어짐", 누르면 관련 메모·이동 기록이 펼쳐지고 그 메모 점은 그 주제 색(§4-4·F2·F6)', async ({ page }) => {
  await boot(page);
  const { front, memoId } = await frontCard(page);
  const other = await page.evaluate(async (f) => {
    const db = (window as unknown as { __kk: KkDb }).__kk.db;
    const o = (await db.memos.toArray()).find((m: any) => m.status === 'organized' && m.topicId && m.topicId !== f);
    const t = await db.topics.get(o.topicId);
    return { memoId: o.id as string, topicId: o.topicId as string, name: t.name as string, color: t.color as string };
  }, front);
  await page.evaluate(
    async ({ memoId, other, front }) => {
      const db = (window as unknown as { __kk: KkDb }).__kk.db;
      await db.links.where('fromId').equals(memoId).delete();
      await db.links.where('toId').equals(memoId).delete();
      await db.links.put({ id: `${memoId}|${other.memoId}`, fromId: memoId, toId: other.memoId, strength: 0.9, reason: '같은 동네 이야기' });
      await db.batches.put({ id: 'e2e-b', topicId: front, at: Date.now(), prevName: '', prevSummary: '', prevCenterKeywords: [], newName: '', moveCount: 1, undone: false });
      await db.moves.put({ id: 'e2e-m', batchId: 'e2e-b', memoId, fromTopicId: other.topicId, toTopicId: front, reason: '이쪽 이야기에 더 가까워요', at: Date.now() });
    },
    { memoId, other, front },
  );
  await openFocus(page, memoId);
  const line = page.getByTestId('focus-conn');
  await expect(line).toContainText(`↗ ${other.name}`);
  await expect(line).toContainText('이어짐');
  // 그 메모 점은 연결된 주제 색
  const dot = page.locator(`[data-testid="focus-dot"][data-memo-id="${memoId}"]`);
  await expect(dot).toHaveClass(/link/);
  expect(await dot.evaluate((e) => (e as HTMLElement).style.getPropertyValue('--lc'))).toBe(other.color);

  await line.click();
  await expect(page.getByTestId('related-list')).toContainText('같은 동네 이야기');
  await expect(page.getByTestId('move-list').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('move-list')).toContainText('이쪽 이야기에 더 가까워요');
  // 펼친 동안 점은 숨는다
  await expect(page.getByTestId('focus-dot')).toHaveCount(0);
  // 관련 메모를 누르면 그 메모로
  await page.getByTestId('related-list').locator('button').first().click();
  await expect(page.getByTestId('memo-sheet')).toHaveAttribute('data-focus-memo', other.memoId);
});

test('포커스: 고치는 중에 닫아도 글이 저장되고 카드 자리로 줄어들어 카드가 다시 보인다', async ({ page }) => {
  await boot(page);
  const { memoId } = await frontCard(page);
  await openFocus(page, memoId);
  await page.getByTestId('edit-text').click();
  await page.getByTestId('sheet-edit').fill('닫으면서 저장되는 글');
  await tapEmpty(page);
  // 줄어드는 껍데기가 보였다가
  await expect(page.locator('.mp-ghost')).toHaveCount(1);
  await expect(page.getByTestId('memo-focus')).toHaveCount(0);
  await expect(page.locator('.mp-ghost')).toHaveCount(0);
  await expect.poll(() => cardShown(page, memoId)).toBe(true);
  expect((await memoOf(page, memoId))!.text).toBe('닫으면서 저장되는 글');
});
