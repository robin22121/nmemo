import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'dist-artifact', 'dev-dist', 'node_modules', 'functions/lib', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // src/core는 React Native 이전을 위해 플랫폼 의존 없는 순수 TS여야 한다 (DESIGN 8.1)
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'dexie', 'dexie-react-hooks', 'framer-motion', 'vite*'], message: 'src/core는 React/Dexie/framer-motion을 import할 수 없어요.' },
            { group: ['**/ui/**', '**/db/**', '**/motion/**', '**/organize/remote*', '**/organize/photo*'], message: 'src/core는 플랫폼 계층(ui/db/motion)을 import할 수 없어요.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'createImageBitmap', 'fetch'].map((name) => ({
          name,
          message: 'src/core에서는 브라우저 전역을 쓰지 않아요(어댑터로 주입).',
        })),
      ],
    },
  },
);
