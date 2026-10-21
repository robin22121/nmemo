/** 문자열 → 32비트 해시(FNV-1a) */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 시드 고정 난수 [0,1) (mulberry32) */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** id에서 만든 [-1,1] 값 (카드 기울기 등 결정적 장식용) */
export function hashUnit(id: string, salt = ''): number {
  return (hashString(id + salt) / 4294967295) * 2 - 1;
}
