import { expect, test, type Page } from '@playwright/test';

// 로그인 범위(/api만 보호): vite preview에서는 미들웨어가 돌지 않으므로 /api/**를 가로채
// 맞는 Authorization이 없으면 401({error:'unauthorized'}, WWW-Authenticate 없음)을 돌려준다.

const ID = 'me';
const PW = 'right-pw';
const GOOD = `Basic ${Buffer.from(`${ID}:${PW}`).toString('base64')}`;

async function guardApi(page: Page) {
  const seen: { path: string; auth: string | undefined; status: number }[] = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const auth = req.headers()['authorization'];
    const path = new URL(req.url()).pathname;
    if (auth !== GOOD) {
      seen.push({ path, auth, status: 401 });
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) });
    }
    seen.push({ path, auth, status: 200 });
    if (path === '/api/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ai: true }) });
    return route.continue();
  });
  return seen;
}

const health = (page: Page) =>
  page.evaluate(async () => {
    const v = localStorage.getItem('kk.auth');
    const r = await fetch('/api/health', { headers: v ? { authorization: `Basic ${v}` } : {} });
    return { status: r.status, body: await r.json() };
  });

test('로그인: 시작 401이면 칸이 열리고, 틀린 비밀번호는 안내, 맞으면 닫히고 health ai:true, 새로 고침 뒤 저장된 정보 재사용', async ({ page }) => {
  const seen = await guardApi(page);
  await page.goto('/?demo=1&reset=1&write=0');
  const sheet = page.getByTestId('login-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('AI 정돈을 쓰려면 로그인해 주세요');
  await expect(page.getByTestId('login-id')).toHaveAttribute('autocomplete', 'username');
  await expect(page.getByTestId('login-pw')).toHaveAttribute('autocomplete', 'current-password');

  await page.getByTestId('login-id').fill(ID);
  await page.getByTestId('login-pw').fill('wrong');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toHaveText('아이디나 비밀번호가 맞지 않아요');
  await expect(sheet).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('kk.auth'))).toBeNull();

  await page.getByTestId('login-pw').fill(PW);
  await page.getByTestId('login-submit').click();
  await expect(sheet).toHaveCount(0);
  expect(await health(page)).toEqual({ status: 200, body: { ai: true } });
  expect(seen.some((s) => s.path === '/api/health' && s.status === 200)).toBe(true);

  // 새로 고침: 저장된 정보로 health가 통과 → 칸이 열리지 않는다
  seen.length = 0;
  await page.reload();
  await expect(page.getByTestId('board')).toHaveAttribute('data-settled', '1');
  await expect.poll(() => seen.some((s) => s.path === '/api/health' && s.status === 200)).toBe(true);
  await expect(sheet).toHaveCount(0);
  expect(seen.filter((s) => s.status === 401)).toEqual([]);

  // + 길게 누르기 메뉴의 "로그인 정보 지우기"
  const b = (await page.getByTestId('plus-button').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId('menu-panel')).toBeVisible();
  await page.mouse.up();
  await page.getByTestId('menu-logout').click();
  await expect(page.getByTestId('toast-text')).toHaveText('로그인 정보를 지웠어요');
  expect(await page.evaluate(() => localStorage.getItem('kk.auth'))).toBeNull();
});

test('로그인: "나중에"를 누르면 닫히고, 그 실행 동안은 기기 안 정돈으로 정리하며 다시 묻지 않는다', async ({ page }) => {
  await guardApi(page);
  await page.goto('/?demo=1&reset=1&write=0');
  const sheet = page.getByTestId('login-sheet');
  await expect(sheet).toBeVisible();
  await page.getByTestId('login-later').click();
  await expect(sheet).toHaveCount(0);
  // 새 메모를 저장해도(→ 대기열이 돎) 칸이 다시 열리지 않고, 메모는 기기 안 정돈으로 정리된다
  await page.evaluate(async () => {
    const kk = (window as unknown as { __kk: { db: { memos: { add(m: object): Promise<unknown> } }; queue: { wake(): void } } }).__kk;
    await kk.db.memos.add({ id: 'later-1', input: 'text', text: '나중에 정리될 메모', status: 'pending', attempts: 0, topicLocked: false, createdAt: Date.now() });
    kk.queue.wake();
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const kk = (window as unknown as { __kk: { db: { memos: { get(id: string): Promise<{ status: string } | undefined> } } } }).__kk;
        return (await kk.db.memos.get('later-1'))?.status;
      }),
    )
    .toBe('organized');
  await expect(sheet).toHaveCount(0);
});

test.describe('로그인 칸 캡처', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  test('390×844 DPR3', async ({ page }) => {
    await guardApi(page);
    await page.goto('/?demo=1&reset=1&write=0');
    await expect(page.getByTestId('login-sheet')).toBeVisible();
    await page.getByTestId('login-id').fill(ID);
    await page.getByTestId('login-pw').fill('wrong');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    await page.screenshot({ path: '/tmp/claude-501/login/sheet.png' });
  });
});
