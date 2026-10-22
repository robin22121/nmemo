import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { kkeujeogimApi } from './server/devMiddleware';

/** 빌드 식별자: git 짧은 커밋 → Vercel 커밋 → dev */
function buildId(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch {
    return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev';
  }
}

export default defineConfig(({ mode }) => ({
  // mode 'artifact': claude.ai 아티팩트로 올리는 단일 HTML용 빌드(서비스 워커 없음, 데모 데이터 기본)
  base: mode === 'artifact' ? './' : '/',
  plugins: [
    react(),
    kkeujeogimApi(),
    mode !== 'artifact' &&
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: '끄적임 노트',
        short_name: '끄적임',
        description: '떠오르는 생각을 아무렇게나 던지면 주제별로 모여드는 아이디어 노트',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f1e7',
        theme_color: '#f6f1e7',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  server: { host: true },
}));
