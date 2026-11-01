// EVER mechanics sandbox: the same rules as sandbox/check.js, as an ESLint flat-config
// entry for editors and for CI if the Technical Director adds ESLint (it is not a
// dependency today; check.js is the enforced checker). Usage in eslint.config.js:
//   import sandbox from './game/src/mechanics/sandbox/eslint.sandbox.js'
//   export default [sandbox]
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {ALLOWED_GLOBALS, BANNED, IMPORT_ALLOWLIST} from './check.js'

const ban = (selector, message) => ({selector, message})

export default {
	files: ['game/src/mechanics/blocks/**/*.js'],
	ignores: ['game/src/mechanics/blocks/index.js'],
	languageOptions: {
		ecmaVersion: 2022,
		sourceType: 'module',
		globals: Object.fromEntries(ALLOWED_GLOBALS.map((g) => [g, 'readonly'])),
	},
	linterOptions: {noInlineConfig: true, reportUnusedDisableDirectives: 'error'},
	rules: {
		'no-undef': 'error',
		'no-restricted-globals': ['error', ...BANNED],
		'no-restricted-properties': [
			'error',
			{object: 'Math', property: 'random', message: 'Use api.random() (deterministic).'},
			...['constructor', 'prototype', '__proto__', 'caller', 'callee', 'bind', 'call', 'apply'].map((property) => ({property})),
		],
		'no-restricted-imports': ['error', {patterns: [{group: ['*', `!${IMPORT_ALLOWLIST[0]}`], message: `Code blocks import only ${IMPORT_ALLOWLIST.join(', ')}.`}]}],
		'no-restricted-syntax': [
			'error',
			ban('ImportExpression', 'No dynamic import.'),
			ban('MetaProperty', 'No import.meta / new.target.'),
			ban('ThisExpression', 'No this.'),
			ban('NewExpression', 'No new.'),
			ban('ClassDeclaration, ClassExpression', 'No classes.'),
			ban('WhileStatement, DoWhileStatement, ForStatement, ForInStatement, ForOfStatement', 'No loops: use api.repeat(n, fn).'),
			ban('TemplateLiteral, TaggedTemplateExpression', 'No template literals.'),
			ban('Literal[regex]', 'No regex literals.'),
			ban('MemberExpression[computed=true][property.type!="Literal"]', 'No computed member access: use lib.at(list, i).'),
			ban('AwaitExpression, YieldExpression, FunctionDeclaration[async=true], ArrowFunctionExpression[async=true], FunctionDeclaration[generator=true]', 'No async or generators.'),
			ban('WithStatement, DebuggerStatement', 'Not allowed.'),
			ban('UnaryExpression[operator="delete"], UnaryExpression[operator="void"], BinaryExpression[operator="in"], BinaryExpression[operator="instanceof"]', 'Not allowed.'),
			ban('ExportNamedDeclaration[declaration=null], ExportDefaultDeclaration, ExportAllDeclaration', 'Only `export const block` and `export function run`.'),
		],
		'max-lines': ['error', {max: 120}],
	},
}
