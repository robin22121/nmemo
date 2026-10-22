/**
 * 내보내기·가져오기의 IndexedDB(Dexie) 어댑터(Z3). 합치기 규칙은 core/exportImport에 있고,
 * 여기서는 사진 Blob ↔ data URL 변환과 읽기·쓰기만 한다.
 */
import {
  BROKEN_FILE,
  buildExport,
  exportFileName,
  ImportError,
  mergeImport,
  parseExport,
  type ImportResult,
  type Tables,
} from '../core/exportImport';
import type { Memo } from '../core/types';
import { getDb, type KkeujeogimDB } from './schema';

/** Blob → `data:<원래 type>;base64,…` (type이 비어 있으면 비운 채로) */
export async function blobToDataUrl(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${b.type};base64,${btoa(bin)}`;
}

/** data URL → Blob(type 그대로). base64가 아니거나 깨졌으면 ImportError */
export function dataUrlToBlob(url: string): Blob {
  const m = /^data:(.*?);base64,(.*)$/.exec(url);
  if (!m) throw new ImportError(BROKEN_FILE);
  const [, type = '', b64 = ''] = m;
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new ImportError(BROKEN_FILE);
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

function tablesOf(db: KkeujeogimDB) {
  return [db.memos, db.topics, db.links, db.moves, db.batches];
}

async function readTables(db: KkeujeogimDB): Promise<Tables> {
  return db.transaction('r', tablesOf(db), async () => ({
    memos: await db.memos.toArray(),
    topics: await db.topics.toArray(),
    links: await db.links.toArray(),
    moves: await db.moves.toArray(),
    batches: await db.batches.toArray(),
  }));
}

/** 내보낼 파일 이름과 JSON 글. withPhotos=false면 사진 필드가 없다("사진 빼고") */
export async function prepareExport(withPhotos: boolean, now = new Date(), db: KkeujeogimDB = getDb()): Promise<{ name: string; text: string }> {
  const data = await readTables(db);
  let photos: Map<string, string> | null = null;
  if (withPhotos) {
    photos = new Map();
    for (const m of data.memos) if (m.photo) photos.set(m.id, await blobToDataUrl(m.photo));
  }
  return { name: exportFileName(now), text: JSON.stringify(buildExport(data, photos, now.getTime())) };
}

/** 파일 글을 지금 DB에 합친다. 사진은 트랜잭션 밖에서 먼저 풀고, 쓰기는 한 트랜잭션 */
export async function importBackup(text: string, db: KkeujeogimDB = getDb()): Promise<ImportResult> {
  const file = parseExport(text);
  const incoming: Tables = {
    memos: file.memos.map(({ photo, ...m }) => (photo === undefined ? m : { ...m, photo: dataUrlToBlob(photo) })),
    topics: file.topics,
    links: file.links,
    moves: file.moves,
    batches: file.batches,
  };
  return db.transaction('rw', tablesOf(db), async () => {
    const ids = async (t: { toCollection(): { primaryKeys(): Promise<unknown[]> } }) => new Set((await t.toCollection().primaryKeys()) as string[]);
    const { add, result } = mergeImport(
      {
        memoIds: await ids(db.memos),
        topics: await db.topics.toArray(),
        linkIds: await ids(db.links),
        moveIds: await ids(db.moves),
        batchIds: await ids(db.batches),
      },
      incoming,
    );
    await db.topics.bulkAdd(add.topics);
    await db.memos.bulkAdd(add.memos as Memo[]);
    await db.links.bulkAdd(add.links);
    await db.batches.bulkAdd(add.batches);
    await db.moves.bulkAdd(add.moves);
    return result;
  });
}
