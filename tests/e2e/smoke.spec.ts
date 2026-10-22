import { expect, test, type Page } from '@playwright/test';

const info = (page: Page) => page.getByTestId('board-info');
const clusters = async (page: Page) => Number(await info(page).getAttribute('data-clusters'));

/** write=true면 쓰기 칸이 열린 채로 시작(기본), false면 바로 보드 */
async function openDemo(page: Page, write = false) {
  await page.goto(write ? '/?demo=1&reset=1' : '/?demo=1&reset=1&write=0');
  await expect(info(page)).toHaveAttribute('data-cards', '40');
}

/** 열려 있는 쓰기 칸에 쓰고 저장 */
async function addText(page: Page, text: string) {
  await page.getByTestId('globe-composer-input').fill(text);
  await page.getByTestId('globe-composer-input').press('Enter');
}

test('서버는 키가 없으면 ai:false로 알린다(Local 분석기 자동 선택)', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(await res.json()).toEqual({ ai: false });
  expect((await request.post('/api/organize', { data: {} })).status()).toBe(503);
});

test('빈 상태에는 안내 문구가 보인다', async ({ page }) => {
  await page.goto('/?write=0');
  await expect(page.getByText('떠오르는 걸 아무렇게나 던져보세요')).toBeVisible();
});

test('데모: 40개 메모가 6개 무리로 보인다', async ({ page }) => {
  await openDemo(page);
  expect(await clusters(page)).toBe(6);
  await expect(page.locator('.g-cluster[data-lod="open"] .g-tag').first()).toBeVisible();
});

test('글 메모를 저장하면 대기 자리에 앉았다가 정돈되어 제 무리로 날아가 붙는다', async ({ page }) => {
  await openDemo(page, true);
  const before = await clusters(page);
  await addText(page, '새로 생긴 카페에서 커피 원두 사오기');

  // 즉시 pending으로 저장되어 대기 자리에 나타난다
  await expect(page.getByTestId('pending-card').first()).toBeVisible({ timeout: 3000 });
  // 정돈되면 대기 자리에서 사라지고 보드 카드가 41개가 된다
  await expect(info(page)).toHaveAttribute('data-cards', '41', { timeout: 10_000 });
  await expect(page.getByTestId('pending-card')).toHaveCount(0);
  await expect(page.getByTestId('flight-card')).toHaveCount(0, { timeout: 5000 });
  // 비슷한 주제('동네 카페')에 붙었으므로 새 무리는 생기지 않는다
  expect(await clusters(page)).toBe(before);

  const card = page.locator('[data-memo-id]', { hasText: '새로 생긴 카페에서' });
  await expect(card).toHaveCount(1);
  const db = await page.evaluate(async () => {
    const { db } = (window as unknown as { __kk: { db: { memos: { toArray(): Promise<{ text: string; status: string; topicId: string }[]> }; topics: { get(id: string): Promise<{ name: string } | undefined> } } } }).__kk;
    const m = (await db.memos.toArray()).find((x) => x.text.startsWith('새로 생긴 카페에서'))!;
    return { status: m.status, topic: (await db.topics.get(m.topicId))?.name };
  });
  expect(db).toEqual({ status: 'organized', topic: '동네 카페' });
});

test('전혀 다른 글은 새 주제 무리를 만든다', async ({ page }) => {
  await openDemo(page, true);
  await addText(page, '기타 코드 연습 아침마다 하기');
  await expect(info(page)).toHaveAttribute('data-cards', '41', { timeout: 10_000 });
  await expect(info(page)).toHaveAttribute('data-clusters', '7');
});

test('카드를 누르면 메모장이 열려 관련 메모가 보이고 주제를 바꾸고 지울 수 있다', async ({ page }) => {
  await openDemo(page);
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  const front = (await board.getAttribute('data-front'))!;
  const card = page.locator(`.g-cluster[data-topic-id="${front}"] .g-card[data-memo-id]`).first();
  const memoId = (await card.getAttribute('data-memo-id'))!;
  await page.locator(`.g-card[data-memo-id="${memoId}"] .face`).click();
  const sheet = page.getByTestId('memo-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('sheet-text')).toBeVisible();

  await page.getByTestId('change-topic').click();
  const other = page.getByTestId('topic-pick').locator('button:not(.current)').first();
  const name = (await other.textContent())!.trim();
  await other.click();
  await expect(page.getByTestId('toast-text')).toHaveText('주제를 옮겼어요');
  await expect(sheet.locator('.topic-chip.current')).toHaveText(name);

  // 삭제
  await page.getByTestId('delete-memo').click();
  await page.getByTestId('confirm-delete').click();
  await expect(info(page)).toHaveAttribute('data-cards', '39');
});

test('감소 모션: 비행 연출 없이도 정돈되어 붙는다', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDemo(page, true);
  await addText(page, '새로 생긴 카페에서 커피 원두 사오기');
  await expect(info(page)).toHaveAttribute('data-cards', '41', { timeout: 10_000 });
  await expect(page.getByTestId('flight-card')).toHaveCount(0);
});

test('주제 재구성: 중심이 옮겨가면 맞지 않는 메모가 빠지고 알림에서 되돌릴 수 있다', async ({ page }) => {
  await openDemo(page);
  await page.evaluate(async () => {
    const { db, queue } = (window as unknown as { __kk: { db: any; queue: { wake(): void } } }).__kk; // eslint-disable-line @typescript-eslint/no-explicit-any
    const now = Date.now();
    const mk = (id: string, topicId: string, summary: string, keywords: string[]) => ({
      id, createdAt: now - 1000, input: 'text', text: summary, kind: 'idea', emotion: { label: '담담', color: '#c9c2b0' },
      keywords, summary, topicId, topicLocked: false, status: 'organized', attempts: 0,
    });
    await db.topics.add({ id: 'person', name: '인물', summary: '인물 이야기', color: '#b58de8', createdAt: now - 5, centerKeywords: ['황영조', '올림픽', '금메달'], nameLocked: false, lastReorgAt: now, sinceReorg: 0 });
    await db.memos.bulkAdd([
      mk('p1', 'person', '올림픽 금메달 기록 정리', ['올림픽', '금메달']),
      mk('p2', 'person', '황영조 선수 올림픽 영상', ['황영조', '올림픽']),
      mk('r1', 'demo-topic-run', '마라톤화 새 용품 사기', ['마라톤화', '용품']),
      mk('r2', 'demo-topic-run', '러닝 양말 용품 주문', ['러닝', '양말', '용품']),
      mk('r3', 'demo-topic-run', '가민 시계 용품 비교', ['가민', '시계', '용품']),
      mk('r4', 'demo-topic-run', '황영조 마라톤 올림픽 금메달', ['황영조', '마라톤', '올림픽', '금메달']),
    ]);
    await db.topics.update('demo-topic-run', { sinceReorg: 6, lastReorgAt: 0 });
    queue.wake();
  });
  await expect(page.getByTestId('toast-text')).toContainText("메모 1개가 '인물'로 옮겨졌어요");
  const where = () => page.evaluate(async () => {
    const { db } = (window as unknown as { __kk: { db: any } }).__kk; // eslint-disable-line @typescript-eslint/no-explicit-any
    return (await db.memos.get('r4')).topicId as string;
  });
  expect(await where()).toBe('person');
  await page.getByTestId('toast-action').click();
  await expect(page.getByTestId('toast-text')).toHaveText('되돌렸어요');
  expect(await where()).toBe('demo-topic-run');
});
