module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'dist-electron', 'release', 'build', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-case-declarations': 'warn',
    'react-hooks/exhaustive-deps': 'warn',
  },
  overrides: [
    {
      // Main-process code is Node, not browser.
      files: ['electron/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
      env: { browser: false, node: true },
    },
  ],
}
