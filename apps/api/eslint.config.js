import base from '@blue/config/eslint';

export default [
  ...base,
  {
    rules: {
      // NestJS modules are decorated classes with only static members.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
