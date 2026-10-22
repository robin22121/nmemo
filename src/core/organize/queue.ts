import type { Repo } from '../repo';
import type { Memo } from '../types';
import { applyResult, type ApplyOutcome } from './apply';
import { applyReorganize, buildReorganizeRequest, isReorgDue, type ReorgOutcome } from './reorganize';
import { MAX_RECENT, MAX_TOPICS, type AnalyzeRequest, type Analyzer } from './types';
import { validateReorganize, validateResult } from './validate';

export type QueueEvent =
  | { type: 'processing'; memoId: string }
  | { type: 'organized'; outcome: ApplyOutcome }
  | { type: 'failed'; memoId: string; attempts: number }
  | { type: 'reorganized'; outcome: ReorgOutcome };

export const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 4000;

/** 사진을 base64로 읽는 플랫폼 어댑터(브라우저/RN이 각자 구현해서 주입) */
export type PhotoReader = (photo: Blob) => Promise<{ base64: string; mime: string }>;

export async function buildRequest(repo: Repo, memo: Memo, readPhoto?: PhotoReader): Promise<AnalyzeRequest> {
  const topics = (await repo.listTopics())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_TOPICS)
    .map((t) => ({ id: t.id, name: t.name, summary: t.summary, color: t.color }));
  const recent = (await repo.listMemosByStatus('organized'))
    .filter((m) => m.id !== memo.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_RECENT)
    .map((m) => ({ id: m.id, summary: m.summary ?? m.text.slice(0, 40), topicId: m.topicId }));
  const req: AnalyzeRequest = { memo: { id: memo.id, input: memo.input, text: memo.text }, topics, recent };
  if (readPhoto && memo.photo) {
    const p = await readPhoto(memo.photo);
    req.memo.photoBase64 = p.base64;
    req.memo.photoMime = p.mime;
  }
  return req;
}

export interface QueueOptions {
  readPhoto?: PhotoReader;
  now?: () => number;
  /** 온라인 복귀 같은 외부 신호를 연결하는 훅. 해제 함수를 돌려준다. */
  onWakeSignal?: (wake: () => void) => () => void;
}

/**
 * pending/failed(시도<3) 메모를 오래된 순으로 한 번에 하나씩 정돈하고,
 * 정돈할 게 없을 때 재구성이 필요한 주제를 처리한다.
 */
export class OrganizeQueue {
  private running = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(e: QueueEvent) => void>();
  private detach: (() => void) | null = null;
  private readonly now: () => number;
  processingId: string | null = null;

  constructor(
    private readonly repo: Repo,
    private analyzer: Analyzer | (() => Promise<Analyzer>),
    private readonly opts: QueueOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  subscribe(fn: (e: QueueEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: QueueEvent) {
    for (const l of this.listeners) l(e);
  }

  start() {
    this.detach =
      this.opts.onWakeSignal?.(() => {
        void this.resetBackoff().then(() => this.wake());
      }) ?? null;
    this.wake();
  }

  stop() {
    this.detach?.();
    this.detach = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** 새 메모 저장 시, 온라인 복귀 시 호출 */
  wake(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    void this.loop();
  }

  /** 모든 작업이 끝날 때까지 기다린다(테스트용) */
  async drain(): Promise<void> {
    this.wake();
    while (this.running) await new Promise((r) => setTimeout(r, 5));
  }

  async retry(memoId: string): Promise<void> {
    await this.repo.updateMemo(memoId, { status: 'pending', attempts: 0, retryAt: undefined });
    this.wake();
  }

  private async resetBackoff() {
    for (const m of await this.repo.listMemosByStatus('failed')) await this.repo.updateMemo(m.id, { retryAt: undefined });
  }

  private async resolveAnalyzer(): Promise<Analyzer> {
    if (typeof this.analyzer === 'function') this.analyzer = await this.analyzer();
    return this.analyzer;
  }

  private async pickNext(): Promise<{ memo?: Memo; nextAt?: number }> {
    const all = await this.repo.listMemosByStatus('pending', 'failed');
    all.sort((a, b) => a.createdAt - b.createdAt);
    const t = this.now();
    let nextAt: number | undefined;
    for (const m of all) {
      if (m.status === 'failed') {
        if (m.attempts >= MAX_ATTEMPTS) continue;
        if ((m.retryAt ?? 0) > t) {
          nextAt = Math.min(nextAt ?? Infinity, m.retryAt!);
          continue;
        }
      }
      return { memo: m };
    }
    return { nextAt };
  }

  private async loop() {
    this.running = true;
    try {
      do {
        this.again = false;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        for (;;) {
          const { memo, nextAt } = await this.pickNext();
          if (memo) {
            await this.process(memo);
            continue;
          }
          if (await this.reorganizeOne()) continue;
          if (nextAt !== undefined) this.timer = setTimeout(() => this.wake(), Math.max(50, nextAt - this.now()));
          break;
        }
      } while (this.again);
    } finally {
      this.running = false;
    }
  }

  private async process(memo: Memo) {
    this.processingId = memo.id;
    this.emit({ type: 'processing', memoId: memo.id });
    try {
      const analyzer = await this.resolveAnalyzer();
      const req = await buildRequest(this.repo, memo, analyzer.usesPhoto ? this.opts.readPhoto : undefined);
      const result = validateResult(await analyzer.analyze(req), req);
      const outcome = await applyResult(this.repo, memo.id, result, this.now());
      if (outcome) this.emit({ type: 'organized', outcome });
    } catch {
      const cur = await this.repo.getMemo(memo.id);
      if (cur) {
        const attempts = cur.attempts + 1;
        await this.repo.updateMemo(memo.id, {
          status: 'failed',
          attempts,
          retryAt: this.now() + BASE_BACKOFF_MS * 2 ** (attempts - 1),
        });
        this.emit({ type: 'failed', memoId: memo.id, attempts });
      }
    } finally {
      this.processingId = null;
    }
  }

  /** 재구성할 주제 하나를 처리했으면 true */
  private async reorganizeOne(): Promise<boolean> {
    const t = this.now();
    const due = (await this.repo.listTopics()).filter((x) => isReorgDue(x, t)).sort((a, b) => a.lastReorgAt - b.lastReorgAt)[0];
    if (!due) return false;
    try {
      const analyzer = await this.resolveAnalyzer();
      const req = await buildReorganizeRequest(this.repo, due.id);
      if (!req) return false;
      const result = validateReorganize(await analyzer.reorganize(req), req);
      const outcome = await applyReorganize(this.repo, due.id, result, t);
      if (outcome?.batchId) this.emit({ type: 'reorganized', outcome });
    } catch {
      // 실패하면 이번 간격은 건너뛴다(10분 뒤 다시)
      await this.repo.updateTopic(due.id, { lastReorgAt: t });
    }
    return true;
  }
}
