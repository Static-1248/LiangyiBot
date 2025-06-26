module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    '@typescript-eslint/recommended'
  ],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json'
  },
  env: {
    es6: true,
    node: true
  },
  rules: {
    // 对应原 tslint 规则转换
    'no-console': 'off',
    'guard-for-in': 'off',
    '@typescript-eslint/no-unused-vars': 'warn',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-namespace': 'off',
    '@typescript-eslint/prefer-namespace-keyword': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    // 其他实用规则
    'no-empty': 'warn',
    'prefer-const': 'warn'
  },
  ignorePatterns: [
    '**/*.d.ts',
    'dist/**/*',
    'node_modules/**/*'
  ]
}; 