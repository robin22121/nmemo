import type { ReorgOutcome } from './reorganize';

/** 받침 유무 */
function jong(word: string): number {
  const code = word.trim().charCodeAt(word.trim().length - 1);
  if (code < 0xac00 || code > 0xd7a3) return -1; // 한글이 아니면 판단 불가
  return (code - 0xac00) % 28;
}
export const iga = (w: string) => (jong(w) > 0 ? '이' : jong(w) === 0 ? '가' : '이(가)');
export const euro = (w: string) => (jong(w) > 0 && jong(w) !== 8 ? '으로' : jong(w) === 0 || jong(w) === 8 ? '로' : '(으)로');

const q = (s: string) => `'${s}'`;

/** 재구성 알림 문구. 예: '마라톤'이 '운동용품'이 되면서 메모 1개가 '인물'로 옮겨졌어요 */
export function describeReorg(o: Pick<ReorgOutcome, 'oldName' | 'newName' | 'renamed' | 'moved'>): string {
  const n = o.moved.length;
  const dest = n > 0 ? [...new Set(o.moved.map((m) => m.toName))] : [];
  const where = dest.length === 0 ? '' : dest.length === 1 ? q(dest[0]!) : `${q(dest[0]!)} 외 ${dest.length - 1}곳`;
  const lastWord = dest.length > 1 ? '곳' : (dest[0] ?? '');
  const moved = n > 0 ? `메모 ${n}개가 ${where}${euro(lastWord) === '(으)로' ? '(으)로' : euro(lastWord)} 옮겨졌어요` : '';
  if (o.renamed && n > 0) return `${q(o.oldName)}${iga(o.oldName)} ${q(o.newName)}${iga(o.newName)} 되면서 ${moved}`;
  if (o.renamed) return `${q(o.oldName)}${iga(o.oldName)} ${q(o.newName)}${iga(o.newName)} 되었어요`;
  return moved;
}
