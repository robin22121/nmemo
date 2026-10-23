import { afterEach, describe, expect, it, vi } from 'vitest';
import middleware, { config } from '../../middleware';
import { LocalAnalyzer } from '../../src/core/organize/local';
import { OrganizeQueue } from '../../src/core/organize/queue';
import { AuthError, type Analyzer } from '../../src/core/organize/types';
import { AUTH_KEY, authHeaders, clearCredentials, encodeCredentials, hasCredentials, saveCredentials } from '../../src/organize/auth';
import { detectAnalyzer, RemoteAnalyzer } from '../../src/organize/remote';
import { MemoryRepo, mkMemo } from './memoryRepo';

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

/** 미들웨어와 같은 방식으로 푼다 */
function decode(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

describe('로그인 정보 저장', () => {
  it('"아이디:비밀번호"를 UTF-8 base64로 만든다(한글·콜론 포함)', () => {
    expect(encodeCredentials('me', 'pw')).toBe(btoa('me:pw'));
    expect(decode(encodeCredentials('나', '비번:12'))).toBe('나:비번:12');
  });

  it('저장·헤더·지우기', () => {
    const s = memStore();
    expect(hasCredentials(s)).toBe(false);
    expect(authHeaders(s)).toEqual({});
    saveCredentials('me', 'pw', s);
    expect(s.m.get(AUTH_KEY)).toBe(btoa('me:pw'));
    expect(hasCredentials(s)).toBe(true);
    expect(authHeaders(s)).toEqual({ authorization: `Basic ${btoa('me:pw')}` });
    clearCredentials(s);
    expect(authHeaders(s)).toEqual({});
  });

  it('저장소가 없어도(null) 깨지지 않는다', () => {
    expect(authHeaders(null)).toEqual({});
    expect(() => saveCredentials('a', 'b', null)).not.toThrow();
  });
});

describe('401 처리', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('RemoteAnalyzer는 401이면 AuthError, health 401이면 detectAnalyzer가 AuthError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'unauthorized' }, { status: 401 })));
    await expect(new RemoteAnalyzer().analyze({ memo: { id: 'a', input: 'text', text: 'x' }, topics: [], recent: [] })).rejects.toBeInstanceOf(AuthError);
    await expect(detectAnalyzer()).rejects.toBeInstanceOf(AuthError);
  });

  it('health가 {ai:true}면 Remote', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ai: true })));
    expect(await detectAnalyzer()).toBeInstanceOf(RemoteAnalyzer);
  });

  it('대기열: 401은 시도 횟수를 쓰지 않고 pending 그대로 멈췄다가, setAnalyzer로 다시 돈다', async () => {
    const repo = new MemoryRepo();
    await repo.addMemo(mkMemo({ id: 'a', createdAt: 1, status: 'pending', text: '카페 책 읽기' }));
    await repo.addMemo(mkMemo({ id: 'b', createdAt: 2, status: 'pending', text: '카페 커피' }));
    let calls = 0;
    const denied: Analyzer = {
      analyze: async () => {
        calls++;
        throw new AuthError();
      },
      reorganize: async () => {
        throw new AuthError();
      },
    };
    let asked = 0;
    const q = new OrganizeQueue(repo, denied, { onAuthRequired: () => asked++ });
    await q.drain();
    await q.drain(); // 멈춘 동안 wake해도 다시 부르지 않는다
    expect([calls, asked]).toEqual([1, 1]);
    for (const id of ['a', 'b']) {
      const m = await repo.getMemo(id);
      expect([m?.status, m?.attempts]).toEqual(['pending', 0]);
    }
    q.setAnalyzer(new LocalAnalyzer());
    await q.drain();
    expect((await repo.getMemo('a'))?.status).toBe('organized');
    expect((await repo.getMemo('b'))?.status).toBe('organized');
    q.stop();
  });

  it('분석기 고르기(health)가 401이어도 같다', async () => {
    const repo = new MemoryRepo();
    await repo.addMemo(mkMemo({ id: 'a', createdAt: 1, status: 'pending' }));
    let asked = 0;
    const q = new OrganizeQueue(repo, async () => { throw new AuthError(); }, { onAuthRequired: () => asked++ });
    await q.drain();
    const m = await repo.getMemo('a');
    expect([m?.status, m?.attempts, asked]).toEqual(['pending', 0, 1]);
  });
});

describe('middleware(/api만 보호)', () => {
  afterEach(() => vi.unstubAllEnvs());
  const req = (auth?: string) => new Request('https://x.test/api/health', { headers: auth ? { authorization: auth } : {} });

  it('matcher는 /api/:path*', () => {
    expect(config.matcher).toEqual(['/api/:path*']);
  });

  it('맞으면 통과, 틀리면 JSON 401(WWW-Authenticate 없음)', async () => {
    vi.stubEnv('APP_LOGIN_ID', 'me');
    vi.stubEnv('APP_LOGIN_PASSWORD', '비번');
    const ok = middleware(req(`Basic ${encodeCredentials('me', '비번')}`));
    expect(ok.headers.get('x-middleware-next')).toBe('1');
    const bad = middleware(req(`Basic ${encodeCredentials('me', 'nope')}`));
    expect(bad.status).toBe(401);
    expect(bad.headers.get('www-authenticate')).toBeNull();
    expect(await bad.json()).toEqual({ error: 'unauthorized' });
    expect(middleware(req()).status).toBe(401);
    expect(middleware(req('Basic !!!')).status).toBe(401);
  });

  it('환경변수가 없으면 막는다(fail-closed)', () => {
    vi.stubEnv('APP_LOGIN_ID', '');
    vi.stubEnv('APP_LOGIN_PASSWORD', '');
    expect(middleware(req(`Basic ${encodeCredentials('', '')}`)).status).toBe(401);
  });
});
