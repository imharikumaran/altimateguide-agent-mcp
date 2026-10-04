import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["dist/**", "build/**", "node_modules/**"] },
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: { ...globals.node },
        },
    },
    js.configs.recommended,
    {
        files: ["**/*.ts"],
        extends: [...tseslint.configs.recommended],
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
        },
    }
);
