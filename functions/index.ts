// Firebase Cloud Functions(2세대, Node 22) 래퍼. 배포 연결(firebase.json rewrites, 비밀 설정)은 2차 작업 — README 참고.
// 이 폴더는 앱 빌드/린트/테스트 대상이 아니다(루트 tsconfig에서 제외).
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { createClient, handleApi } from '../server/organize';

const anthropicKey = defineSecret('ANTHROPIC_API_KEY');

export const api = onRequest({ secrets: [anthropicKey], region: 'asia-northeast3', maxInstances: 5 }, async (req, res) => {
  const client = createClient({ ANTHROPIC_API_KEY: anthropicKey.value() });
  const { status, json } = await handleApi({
    method: req.method,
    path: req.path.startsWith('/api') ? req.path : `/api${req.path}`,
    body: req.body,
    client,
  });
  res.status(status).json(json);
});
