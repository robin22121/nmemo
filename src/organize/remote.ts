import { AuthError, type AnalyzeRequest, type AnalyzeResult, type Analyzer, type ReorganizeRequest, type ReorganizeResult } from '../core/organize/types';
import { LocalAnalyzer } from '../core/organize/local';
import { validateReorganize, validateResult } from '../core/organize/validate';
import { authHeaders } from './auth';

/** 서버 프록시(`/api/*`)를 부르는 분석기. 브라우저용 어댑터. */
export class RemoteAnalyzer implements Analyzer {
  readonly usesPhoto = true;

  constructor(private readonly base = '/api') {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.base}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new AuthError();
    if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
    return res.json();
  }

  async analyze(req: AnalyzeRequest): Promise<AnalyzeResult> {
    return validateResult(await this.post('organize', req), req);
  }

  async reorganize(req: ReorganizeRequest): Promise<ReorganizeResult> {
    return validateReorganize(await this.post('reorganize', req), req);
  }
}

/** 앱 시작 시 `/api/health`가 `{ai:true}`면 Remote, 아니면 Local. 401이면 AuthError(로그인 필요). */
export async function detectAnalyzer(base = '/api', timeoutMs = 2500): Promise<Analyzer> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${base}/health`, { signal: ctrl.signal, headers: authHeaders() });
    clearTimeout(timer);
    if (res.status === 401) throw new AuthError();
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      const body = (await res.json()) as { ai?: unknown };
      if (body.ai === true) return new RemoteAnalyzer(base);
    }
  } catch (e) {
    if (e instanceof AuthError) throw e;
    /* 서버 없음/오프라인 → Local */
  }
  return new LocalAnalyzer();
}
