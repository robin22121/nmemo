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

  // 새로 쓰기 → 쓰기 칸이 다시 열린다
  await page.getByTestId('globe-write').click();
  await expect(input).toBeVisible();
});

test('지구본: 흐린 지구본을 탭하면 저장 없이 닫히고, 쓰던 글은 다시 열 때 남아 있다', async ({ page }) => {
  await openGlobe(page);
  const input = page.getByTestId('globe-composer-input');
  await input.fill('아직 다 못 쓴 생각');
  await page.mouse.click(190, 740);
  await expect(page.getByTestId('globe-composer')).toHaveCount(0);
  await expect(page.getByTestId('board-info')).toHaveAttribute('data-cards', '40');
  await page.getByTestId('globe-write').click();
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
