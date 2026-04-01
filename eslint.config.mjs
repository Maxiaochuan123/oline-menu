import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Project-specific:
    ".history/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    rules: {
      // 本项目大量在 effect 中发起数据加载后 setState，关闭此规则以减少噪声。
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
