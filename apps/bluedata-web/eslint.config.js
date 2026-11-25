import base from '@blue/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...base,
  // Rules of Hooks plus the React Compiler checks (stale closures, impure renders, …).
  reactHooks.configs.flat.recommended,
  { ignores: ['.next/**', '.next-e2e/**', 'next-env.d.ts'] },
];
