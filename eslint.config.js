// ESLint 扁平配置：以正确性为主（typescript-eslint 推荐集），不做风格警察。
// 跑法：npm run lint
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'public/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 仿真/渲染代码里常见且无害的模式
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off', // 项目内 `!` 均为结构保证（id 映射等）
      '@typescript-eslint/no-empty-function': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }], // localStorage 等环境探测大量使用空 catch
    },
  },
);
