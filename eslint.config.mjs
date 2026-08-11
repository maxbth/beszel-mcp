// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';

/*
 * A relative specifier carries no file extension. `./foo.js` is a lie in a TypeScript
 * tree — the file beside it is `foo.ts` — and nothing needs the extension to resolve.
 * BARE specifiers are deliberately untouched: an npm package name cannot start with a
 * dot, so `^\.` is exactly the set of relative specifiers. The pattern carries no `/`
 * on purpose: esquery ends an attribute regex at the first slash.
 */
const NO_RELATIVE_JS_EXTENSION = [
  'ImportDeclaration',
  'ImportExpression',
  'ExportNamedDeclaration',
  'ExportAllDeclaration',
].map((node) => ({
  selector: `${node}[source.value=/^\\..*\\.js$/]`,
  message:
    'Do not put a .js extension on a relative import — the file beside it is TypeScript. Write the specifier extensionless (./foo, not ./foo.js).',
}));

const RESTRICTED_SYNTAX = [
  {
    selector: 'MemberExpression[object.name="process"][property.name="env"]',
    message: 'Use the Config object from src/config.ts instead of process.env. Only config.ts may read the environment.',
  },
  {
    selector: 'UnaryExpression[operator="!"] > UnaryExpression[operator="!"]',
    message: 'Avoid double negation (!!). Use Boolean() for explicit type conversion instead.',
  },
  {
    selector: 'UnaryExpression[operator="!"] > AwaitExpression',
    message:
      'Avoid negating an await directly (!await foo()). Assign the awaited value to a named const and negate that — the precedence reads ambiguously and the name says what is being tested.',
  },
  ...NO_RELATIVE_JS_EXTENSION,
];

export default tseslint.config(
  {ignores: ['**/node_modules/**', '**/dist/**']},
  eslint.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    files: ['**/*.ts'],
    extends: [importPlugin.flatConfigs.recommended, importPlugin.flatConfigs.typescript],
    plugins: {
      '@stylistic': stylistic,
      'unused-imports': unusedImports,
      unicorn: eslintPluginUnicorn,
    },
    rules: {
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      'no-unused-vars': 'off',
      'import/no-unresolved': 'off',

      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/comma-spacing': ['error', {before: false, after: true}],
      '@stylistic/object-curly-spacing': ['error', 'never'],
      '@stylistic/indent': ['error', 2, {SwitchCase: 1}],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/array-type': ['error', {default: 'generic', readonly: 'generic'}],
      '@stylistic/brace-style': ['error', '1tbs'],
      curly: ['error'],
      'default-case': 'error',
      'prefer-template': ['error'],
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_'},
      ],
      '@stylistic/quotes': ['error', 'single', {avoidEscape: true}],
      'unicorn/numeric-separators-style': ['error', {number: {minimumDigits: 0, groupLength: 3}}],
      '@stylistic/member-delimiter-style': [
        'error',
        {
          multiline: {delimiter: 'semi', requireLast: true},
          singleline: {delimiter: 'semi', requireLast: false},
          multilineDetection: 'brackets',
        },
      ],
      '@stylistic/key-spacing': ['error', {beforeColon: false, afterColon: true}],
      '@stylistic/object-property-newline': ['error', {allowAllPropertiesOnSameLine: false}],
      '@stylistic/object-curly-newline': ['error', {multiline: true, consistent: true}],
      '@stylistic/array-bracket-newline': ['error', {multiline: true}],
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX],
    },
  },
  {
    files: ['src/config.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX.filter((r) => !r.selector.includes('process'))],
    },
  },
);
