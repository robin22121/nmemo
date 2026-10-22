import type { Link, Memo, Move, MoveBatch, Topic } from './types';

/**
 * 내보내기·가져오기(Z3). 순수 함수만 둔다: 사진 Blob ↔ data URL 변환과 DB 쓰기는 src/db/backup.ts(어댑터).
 * 가져오기는 합치기: id(UUID)가 같으면 같은 행 → 이미 있는 쪽을 둔다. 이름이 같은 주제(앞뒤 공백 제거, 영문 소문자)는
 * 기존 주제 하나로 합치고 메모·이동 기록·묶음의 주제 참조를 모두 바꿔 쓴다. 지운 메모 기록은 없어 다른 파일에서 되살아날 수 있다.
 */

export const EXPORT_FORMAT = 'kkeujeogim-export';
export const EXPORT_VERSION = 1;

/** 다섯 테이블. P = 사진 표현(DB에서는 Blob, 파일에서는 data URL) */
export interface Tables<P = Blob> {
  memos: (Omit<Memo, 'photo'> & { photo?: P })[];
  topics: Topic[];
  links: Link[];
  moves: Move[];
  batches: MoveBatch[];
}

export interface ExportFile extends Tables<string> {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: number;
}

export interface ImportResult {
  memosAdded: number;
  memosSkipped: number;
  topicsAdded: number;
  topicsMerged: number;
}

/** 가져오기를 멈춰야 하는 파일. message는 그대로 사용자에게 보인다 */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export const NOT_EXPORT_FILE = '끄적임에서 내보낸 파일이 아니에요';
export const NEWER_VERSION = '더 새 버전의 끄적임에서 만든 파일이에요. 앱을 새로 고친 뒤 다시 가져와 주세요';
export const BROKEN_FILE = '파일 내용이 손상되어 가져올 수 없어요';

/**
 * 내보낼 파일 객체. photos = 메모 id → 사진 data URL(어댑터가 만든다). null이면 "사진 빼고": 사진 필드가 없다.
 */
export function buildExport(data: Tables, photos: ReadonlyMap<string, string> | null, now: number): ExportFile {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now,
    memos: data.memos.map(({ photo: _photo, ...m }) => {
      const p = photos?.get(m.id);
      return p ? { ...m, photo: p } : m;
    }),
    topics: data.topics,
    links: data.links,
    moves: data.moves,
    batches: data.batches,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `끄적임-YYYYMMDD-HHmm.json` (기기 시각) */
export function exportFileName(d: Date): string {
  return `끄적임-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (o: Obj, ...keys: string[]) => keys.every((k) => typeof o[k] === 'string');
const num = (o: Obj, ...keys: string[]) => keys.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]));
const STATUSES = new Set(['pending', 'organized', 'failed']);

function rowsOk(v: unknown, ok: (o: Obj) => boolean): boolean {
  return Array.isArray(v) && v.every((o) => isObj(o) && ok(o));
}

/** 파일 글을 읽어 형식·버전·필수 필드를 확인한다. 아니면 ImportError */
export function parseExport(text: string): ExportFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError(NOT_EXPORT_FILE);
  }
  if (!isObj(raw) || raw.format !== EXPORT_FORMAT || typeof raw.version !== 'number') throw new ImportError(NOT_EXPORT_FILE);
  if (raw.version > EXPORT_VERSION) throw new ImportError(NEWER_VERSION);
  if (raw.version !== EXPORT_VERSION) throw new ImportError(NOT_EXPORT_FILE);
  const ok =
    rowsOk(raw.memos, (m) =>
      str(m, 'id', 'text') && num(m, 'createdAt') && STATUSES.has(m.status as string) &&
      (m.topicId === undefined || typeof m.topicId === 'string') &&
      (m.photo === undefined || (typeof m.photo === 'string' && m.photo.startsWith('data:')))) &&
    rowsOk(raw.topics, (t) => str(t, 'id', 'name', 'color') && num(t, 'createdAt')) &&
    rowsOk(raw.links, (l) => str(l, 'id', 'fromId', 'toId')) &&
    rowsOk(raw.moves, (m) => str(m, 'id', 'batchId', 'memoId', 'fromTopicId', 'toTopicId')) &&
    rowsOk(raw.batches, (b) => str(b, 'id', 'topicId'));
  if (!ok) throw new ImportError(BROKEN_FILE);
  return raw as unknown as ExportFile;
}

/** 주제 이름 비교 키: 앞뒤 공백 제거, 영문만 소문자 */
export function normalizeTopicName(name: string): string {
  return name.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** 합치기에 필요한 지금 DB의 모습 */
export interface Existing {
  memoIds: ReadonlySet<string>;
  topics: readonly Topic[];
  linkIds: ReadonlySet<string>;
  moveIds: ReadonlySet<string>;
  batchIds: ReadonlySet<string>;
}

const byAge = <T extends { createdAt: number; id: string }>(a: T, b: T) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * 들어온 테이블을 지금 DB에 합칠 때 새로 쓸 행만 돌려준다(이미 있는 행은 건드리지 않는다).
 * 새 행의 참조(주제·메모·묶음)는 모두 합친 뒤 존재하는 행을 가리킨다: 주제 참조는 바꿔 쓰고,
 * 가리킬 곳이 없는 링크·이동 기록·묶음은 버리며, 주제를 잃은 메모는 다시 정돈하도록 대기로 둔다.
 */
export function mergeImport<P>(existing: Existing, incoming: Tables<P>): { add: Tables<P>; result: ImportResult } {
  const existingTopicIds = new Set(existing.topics.map((t) => t.id));
  const byName = new Map<string, string>();
  for (const t of [...existing.topics].sort(byAge)) if (!byName.has(normalizeTopicName(t.name))) byName.set(normalizeTopicName(t.name), t.id);

  const topicMap = new Map<string, string>();
  const topics: Topic[] = [];
  let topicsAdded = 0;
  let topicsMerged = 0;
  for (const t of [...incoming.topics].sort(byAge)) {
    if (topicMap.has(t.id)) continue; // 파일 안 중복 id
    if (existingTopicIds.has(t.id)) {
      topicMap.set(t.id, t.id);
      continue;
    }
    const key = normalizeTopicName(t.name);
    const same = byName.get(key);
    if (same) {
      topicMap.set(t.id, same);
      topicsMerged++;
      continue;
    }
    topicMap.set(t.id, t.id);
    byName.set(key, t.id);
    topics.push(t);
    topicsAdded++;
  }
  const topicOf = (id: string | undefined) => (id === undefined ? undefined : (topicMap.get(id) ?? (existingTopicIds.has(id) ? id : undefined)));

  const memoIds = new Set(existing.memoIds);
  const memos: Tables<P>['memos'] = [];
  let memosAdded = 0;
  let memosSkipped = 0;
  for (const m of incoming.memos) {
    if (memoIds.has(m.id)) {
      memosSkipped++;
      continue;
    }
    memoIds.add(m.id);
    const tid = topicOf(m.topicId);
    if (m.topicId !== undefined && tid === undefined) {
      const { topicId: _gone, ...rest } = m;
      memos.push({ ...rest, topicLocked: false, status: 'pending', attempts: 0, retryAt: undefined });
    } else {
      memos.push(tid === undefined ? m : { ...m, topicId: tid });
    }
    memosAdded++;
  }

  const linkIds = new Set(existing.linkIds);
  const links: Link[] = [];
  for (const l of incoming.links) {
    if (linkIds.has(l.id) || !memoIds.has(l.fromId) || !memoIds.has(l.toId)) continue;
    linkIds.add(l.id);
    links.push(l);
  }

  const batchIds = new Set(existing.batchIds);
  const batches: MoveBatch[] = [];
  for (const b of incoming.batches) {
    const tid = topicOf(b.topicId);
    if (batchIds.has(b.id) || tid === undefined) continue;
    batchIds.add(b.id);
    batches.push({ ...b, topicId: tid });
  }

  const moveIds = new Set(existing.moveIds);
  const moves: Move[] = [];
  for (const mv of incoming.moves) {
    const from = topicOf(mv.fromTopicId);
    const to = topicOf(mv.toTopicId);
    if (moveIds.has(mv.id) || !batchIds.has(mv.batchId) || !memoIds.has(mv.memoId) || from === undefined || to === undefined) continue;
    moveIds.add(mv.id);
    moves.push({ ...mv, fromTopicId: from, toTopicId: to });
  }

  return { add: { memos, topics, links, moves, batches }, result: { memosAdded, memosSkipped, topicsAdded, topicsMerged } };
}
