/** 긴 변이 maxSide를 넘으면 줄여서 JPEG Blob으로 돌려준다. */
export function fitSize(w: number, h: number, maxSide: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxSide) return { w, h };
  const k = maxSide / longest;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

export async function resizeImage(file: Blob, maxSide = 1600, quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const { w, h } = fitSize(bmp.width, bmp.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality),
  );
}
