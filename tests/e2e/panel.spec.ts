import { expect, test, type Page } from '@playwright/test';

// 메모장(메모 상세): 카드 자리에서 커져 위에 붙고, 고치고 설정하고, 카드 자리로 줄어든다(2026-10-22 작업계획서 §4)
test.use({ viewport: { width: 390, height: 844 } });

/* eslint-disable @typescript-eslint/no-explicit-any */
type KkDb = { db: any };
const memoOf = (page: Page, id: string) =>
  page.evaluate(async (mid) => {
    const db = (window as unknown as { __kk: KkDb }).__kk.db;
    const m = await db.memos.get(mid);
    const t = m?.topicId ? await db.topics.get(m.topicId) : undefined;
    return m ? { text: m.text as string, kind: m.kind, kindLocked: !!m.kindLocked, emotion: m.emotion?.label, emotionLocked: !!m.emotionLocked, done: !!m.done, topicId: m.topicId, topicName: t?.name, status: m.status } : null;
  }, id);

/** 정면 주제의 첫 카드 */
async function frontCard(page: Page) {
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-settled', '1');
  const front = (await board.getAttribute('data-front'))!;
  const card = page.locator(`.g-cluster[data-topic-id="${front}"] .g-card[data-memo-id]`).first();
  const memoId = (await card.getAttribute('data-memo-id'))!;
  return { board, front, card, memoId };
}

async function openPanel(page: Page, memoId: string) {
  await page.locator(`.g-card[data-memo-id="${memoId}"] .face`).click();
  const panel = page.getByTestId('memo-sheet');
  await expect(panel).toBeVisible();
  return panel;
}

const cardShown = (page: Page, memoId: string) =>
  page.locator(`.g-card[data-memo-id="${memoId}"]`).evaluate((el) => (el as HTMLElement).style.visibility !== 'hidden' && getComputedStyle(el.querySelector('.card')!).display !== 'none');

test('메모장: 누른 카드 자리에서 커져 화면 위에 붙고, 닫으면 패널이 사라지고 카드가 다시 보인다(§4-3)', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  const { card, memoId } = await frontCard(page);
  const before = (await card.locator('.card').boundingBox())!;
  const panel = await openPanel(page, memoId);

  // 시작 사각형 = 탭 전 카드 사각형(±6px)
  const from = (await panel.getAttribute('data-flip-from'))!.split(',').map(Number);
  const want = [before.x, before.y, before.width, before.height];
  from.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThanOrEqual(6));
  // 열린 동안 원래 카드는 자리만 지킨다
  expect(await cardShown(page, memoId)).toBe(false);

  // 다 열린 뒤: 위 = safe-area(0) + 12, 왼쪽 12, 폭 = 화면 − 24 (±2px)
  await expect
    .poll(async () => {
      const b = (await panel.boundingBox())!;
      return Math.abs(b.y - 12) <= 2 && Math.abs(b.x - 12) <= 2 && Math.abs(b.width - 366) <= 2;
    })
    .toBe(true);
  await expect(page.locator('.mp-ghost')).toHaveCount(0);
  await expect(page.getByTestId('sheet-close')).toBeFocused();

  await page.getByTestId('sheet-close').click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.mp-ghost')).toHaveCount(0);
  await expect.poll(() => cardShown(page, memoId)).toBe(true);
  // 카드는 원래 자리 그대로
  const after = (await card.locator('.card').boundingBox())!;
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
});

test('메모장: 동작 줄이기에서도 열고 닫힌다(흐려지며, §4-3)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  const { memoId } = await frontCard(page);
  const panel = await openPanel(page, memoId);
  await expect(page.locator('.mp-ghost')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect.poll(() => cardShown(page, memoId)).toBe(true);
});

test('메모장: 글을 고쳐 저장하면 새로고침 뒤에도 남고, 빈 글은 저장하지 않으며, 사진 메모는 설명을 비울 수 있다(§4-1)', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  const { front, memoId } = await frontCard(page);
  const second = (await page.locator(`.g-cluster[data-topic-id="${front}"] .g-card[data-memo-id]`).nth(1).getAttribute('data-memo-id'))!;
  const original = (await memoOf(page, memoId))!.text;

  // 글 고치기 → 완료
  await openPanel(page, memoId);
  await page.getByTestId('edit-text').click();
  const edit = page.getByTestId('sheet-edit');
  await expect(edit).toBeFocused();
  await edit.fill('고친 메모 글입니다');
  await page.getByTestId('edit-done').click();
  await expect(page.getByTestId('sheet-text')).toHaveText('고친 메모 글입니다');
  // 다시 정돈되어도 주제는 그대로(E3)
  await expect.poll(async () => (await memoOf(page, memoId))!.status, { timeout: 10_000 }).toBe('organized');
  expect((await memoOf(page, memoId))!.topicId).toBe(front);

  // 빈 글로 저장하면 원래 글 유지
  await page.getByTestId('edit-text').click();
  await edit.fill('   ');
  await page.getByTestId('edit-done').click();
  await expect(page.getByTestId('toast-text')).toHaveText('빈 메모는 저장하지 않았어요');
  await expect(page.getByTestId('sheet-text')).toHaveText('고친 메모 글입니다');
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('memo-sheet')).toHaveCount(0);

  // 사진 메모: 설명을 비워 저장
  await page.evaluate(async (id) => {
    const db = (window as unknown as { __kk: KkDb }).__kk.db;
    const p = (await db.memos.toArray()).find((m: any) => m.input === 'photo' && m.photo);
    await db.memos.update(id, { input: 'photo', photo: p.photo, text: '사진 설명' });
  }, second);
  await expect(page.locator(`.g-card[data-memo-id="${second}"] .face.photo`)).toHaveCount(1);
  await openPanel(page, second);
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

test('메모장: 종류·감정·완료·주제 바꾸기·새 주제가 저장되고 새로고침 뒤에도 남는다(§4-5)', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  const { front, memoId } = await frontCard(page);
  const panel = await openPanel(page, memoId);

  await page.getByTestId('kind-chip').click();
  await page.getByTestId('kind-opt-todo').click();
  await expect(page.getByTestId('kind-chip')).toHaveText('할 일');
  await page.getByTestId('emotion-chip').click();
  await page.getByTestId('emotion-opt-설렘').click();
  await expect(page.getByTestId('emotion-chip')).toHaveText('설렘');
  await page.getByTestId('todo-toggle').click();
  await expect(page.getByTestId('todo-toggle')).toHaveAttribute('aria-pressed', 'true');

  // 다른 주제로 옮긴 뒤 새 주제 만들기
  const other = await page.evaluate(async (f) => {
    const db = (window as unknown as { __kk: KkDb }).__kk.db;
    return (await db.topics.toArray()).find((t: any) => t.id !== f).name as string;
  }, front);
  await page.getByTestId('change-topic').click();
  await page.getByTestId('topic-pick').getByRole('button', { name: other }).click();
  await expect(panel.locator('.topic-chip.current')).toHaveText(other);
  await page.getByTestId('change-topic').click();
  await page.getByLabel('새 주제 이름').fill('메모장 새 주제');
  await page.getByRole('button', { name: '만들기' }).click();
  await expect(panel.locator('.topic-chip.current')).toHaveText('메모장 새 주제');

  await page.goto('/?demo=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  expect(await memoOf(page, memoId)).toMatchObject({ kind: 'todo', kindLocked: true, emotion: '설렘', emotionLocked: true, done: true, topicName: '메모장 새 주제' });
});

test('메모장: 고치는 중에 닫아도 글이 저장되고 카드 자리로 줄어들어 카드가 다시 보인다(§4-7)', async ({ page }) => {
  await page.goto('/?demo=1&reset=1&write=0');
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  const { memoId } = await frontCard(page);
  await openPanel(page, memoId);
  await page.getByTestId('edit-text').click();
  await page.getByTestId('sheet-edit').fill('닫으면서 저장되는 글');
  await page.getByTestId('sheet-close').click();
  // 줄어드는 껍데기가 보였다가
  await expect(page.locator('.mp-ghost')).toHaveCount(1);
  await expect(page.getByTestId('memo-sheet')).toHaveCount(0);
  await expect(page.locator('.mp-ghost')).toHaveCount(0);
  await expect.poll(() => cardShown(page, memoId)).toBe(true);
  expect((await memoOf(page, memoId))!.text).toBe('닫으면서 저장되는 글');
});
