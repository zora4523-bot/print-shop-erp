import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// 设计系统守门：业务代码（app/ + components/business/）禁止 Tailwind 调色板
// 字面量（如 `bg-amber-50` / `text-emerald-600`）。统一走 globals.css 里
// 的语义 token——`bg-warning/10` / `text-success` / `border-info/40`——
// 这样调整品牌色或加暗色模式时 0 改业务代码。
//
// 例外：components/ui/（shadcn 原子件）允许调色板字面量；shadcn 主要走
// token 化模式，实测不触发，留口子是为了不阻 `npx shadcn add` 新增组件。
const PALETTE_LITERAL_PATTERN =
  "/\\b(bg|text|border|ring|from|to|via|fill|stroke|outline|divide|placeholder|caret|accent|shadow)-(red|orange|amber|blue|green|purple|yellow|pink|rose|cyan|teal|indigo|violet|fuchsia|sky|emerald|lime|stone|slate|zinc|neutral|gray)-\\d{2,3}\\b/";

const ARBITRARY_COLOR_LITERAL_PATTERN =
  "/\\b(bg|text|border|ring|from|to|via|fill|stroke|outline|divide|placeholder|caret|accent)-(\\[#|\\[(rgb|rgba|hsl|hsla|oklab|oklch|lab|lch|color:))/";

const PALETTE_GUARD_MESSAGE =
  "Use design tokens (bg-primary / bg-warning/10 / text-success / border-info/40) instead of Tailwind palette literals. See app/globals.css for the semantic token list.";

const NATIVE_CONFIRM_GUARD_MESSAGE =
  "Use ConfirmActionDialog for confirmations and ActionNotice/FormMessage for operation feedback instead of native alert/confirm dialogs.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "app/**/*.{ts,tsx}",
      "components/business/**/*.{ts,tsx}",
      "components/ui-business/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=${PALETTE_LITERAL_PATTERN}]`,
          message: PALETTE_GUARD_MESSAGE,
        },
        {
          selector: `TemplateElement[value.cooked=${PALETTE_LITERAL_PATTERN}]`,
          message: PALETTE_GUARD_MESSAGE,
        },
        {
          selector: `Literal[value=${ARBITRARY_COLOR_LITERAL_PATTERN}]`,
          message: PALETTE_GUARD_MESSAGE,
        },
        {
          selector: `TemplateElement[value.cooked=${ARBITRARY_COLOR_LITERAL_PATTERN}]`,
          message: PALETTE_GUARD_MESSAGE,
        },
        {
          selector: "CallExpression[callee.name='alert']",
          message: NATIVE_CONFIRM_GUARD_MESSAGE,
        },
        {
          selector: "CallExpression[callee.name='confirm']",
          message: NATIVE_CONFIRM_GUARD_MESSAGE,
        },
        {
          selector:
            "CallExpression[callee.object.name='window'][callee.property.name='alert']",
          message: NATIVE_CONFIRM_GUARD_MESSAGE,
        },
        {
          selector:
            "CallExpression[callee.object.name='window'][callee.property.name='confirm']",
          message: NATIVE_CONFIRM_GUARD_MESSAGE,
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma 7 rust-free client output (regenerated).
    "generated/**",
    // Skeleton files preserved for onboarding; moved into place by P0 features.
    "_reference/**",
    // Vitest coverage report output (gitignored, but eslint would still lint it).
    "coverage/**",
    // Read-only UX design exports include their own bundled browser runtime.
    "docs/ux-redesign/**",
  ]),
]);

export default eslintConfig;
