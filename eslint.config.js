import js from '@eslint/js';
import globals from 'globals';
import jest from 'eslint-plugin-jest';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
                ...jest.environments.globals.globals
            }
        },
        plugins: {
            jest
        },
        rules: {
            'semi': ['error', 'always'],
            'quotes': ['error', 'single', { 'avoidEscape': true }],
            'no-unused-vars': ['warn'],
            'no-console': 'off',
            ...jest.configs.recommended.rules
        }
    }
];
