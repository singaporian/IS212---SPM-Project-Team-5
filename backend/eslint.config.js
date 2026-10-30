const js = require('@eslint/js');
const globals = require('globals');

const rules = {
  ...js.configs.recommended.rules,
  'no-empty': 'off',
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
};

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**']
  },
  {
    files: ['src/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules
  }
];
