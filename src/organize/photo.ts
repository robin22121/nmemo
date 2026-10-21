import type { PhotoReader } from '../core/organize/queue';

export const readPhotoBase64: PhotoReader = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { base64: btoa(bin), mime: blob.type || 'image/jpeg' };
};
