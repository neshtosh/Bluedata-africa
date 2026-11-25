// Shared ESLint flat config. Workspaces import this and append their own rules:
//   import base from '@blue/config/eslint';
//   export default [...base, { /* workspace rules */ }];
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        // Leading underscore marks intentionally unused bindings (e.g. dropping a field).
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      'no-console': 'error', // use the structured logger
    },
  },
);
