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

const NATIVE_CHECKBOX_GUARD_MESSAGE =
  "Use the shared Checkbox component so the 44px target, 20px indicator, keyboard states, and mixed-state semantics stay consistent.";

// next/link 会在生产环境对视口内链接做预取；指向 /api/ 导出接口时每次打开页面
// 都会打一次导出请求（2026-09-29 薪资页 400 即此）。下载用原生 <a href download>。
const API_LINK_GUARD_MESSAGE =
  "Use a native <a href download> for /api/ download routes; next/link prefetches them in production.";

const NATIVE_SELECT_GUARD_MESSAGE =
  "Use NativeSelect from @/components/ui/native-select instead of a raw <select> (ui-规范 §3.2).";
const NATIVE_TEXTAREA_GUARD_MESSAGE =
  "Use Textarea from @/components/ui/textarea instead of a raw <textarea> (ui-规范 §3.2).";

const BUTTON_OVERRIDE_GUARD_MESSAGE =
  "Do not override Button colour or height via className; use variant=\"selected\" / \"destructive\" (ui-规范 §8.2).";

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
        {
          selector:
            "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value='checkbox']",
          message: NATIVE_CHECKBOX_GUARD_MESSAGE,
        },
        {
          selector:
            "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'] > JSXExpressionContainer > Literal[value='checkbox']",
          message: NATIVE_CHECKBOX_GUARD_MESSAGE,
        },
        {
          // ui-规范 §8.1：可见输入统一走 Input 原子件（隐藏值、勾选、单选、文件除外）。
          selector:
            "JSXOpeningElement[name.name='input']:not(:has(JSXAttribute[name.name='type'][value.value=/^(hidden|checkbox|radio|file)$/]))",
          message: "Use Input from @/components/ui/input instead of a raw visible <input> (ui-规范 §8.1).",
        },
        {
          // ui-规范 §8.2：选中用 variant="selected"、危险用 destructive，高度由原子件与 44px 兜底决定。
          selector:
            "JSXOpeningElement[name.name=/^(Button|PendingButton)$/] > JSXAttribute[name.name='className'] Literal[value=/(^|\\s)(bg-(primary|foreground|destructive)|h-\\d|min-h-0!|!min-h-)/]",
          message: BUTTON_OVERRIDE_GUARD_MESSAGE,
        },
        {
          selector:
            "CallExpression[callee.name='buttonVariants'] Property[key.name='className'] Literal[value=/(^|\\s)(bg-(primary|foreground|destructive)|h-\\d|min-h-0!|!min-h-)/]",
          message: BUTTON_OVERRIDE_GUARD_MESSAGE,
        },
        {
          selector:
            "JSXOpeningElement[name.name='Link'] > JSXAttribute[name.name='href'] Literal[value=/^\\/api\\//]",
          message: API_LINK_GUARD_MESSAGE,
        },
        {
          selector:
            "JSXOpeningElement[name.name='Link'] > JSXAttribute[name.name='href'] TemplateLiteral > TemplateElement:first-child[value.cooked=/^\\/api\\//]",
          message: API_LINK_GUARD_MESSAGE,
        },
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: NATIVE_SELECT_GUARD_MESSAGE,
        },
        {
          selector: "JSXOpeningElement[name.name='textarea']",
          message: NATIVE_TEXTAREA_GUARD_MESSAGE,
        },
      ],
    },
  },
  {
    // ui-规范 §8.3：页面标题一律经 PageHeader（含 RuleCenterPageHeader）。只有不挂在
    // 后台 / 师傅端外壳里的独立页面、以及标题原子件本身可以直接写 <h1>。
    files: ["app/**/*.tsx", "components/business/**/*.tsx", "components/ui-business/**/*.tsx"],
    ignores: [
      "**/__tests__/**",
      "app/global-error.tsx",
      "app/(auth)/login/page.tsx",
      "app/account/password/page.tsx",
      "app/wo/[[]orderNo]/page.tsx",
      "components/ui-business/PageHeader.tsx",
      "components/ui-business/EmptyState.tsx",
    ],
    rules: {
      "react/forbid-elements": ["error", { forbid: [{ element: "h1", message: "Use PageHeader for page titles (ui-规范 §8.3)." }] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-release/**",
    ".next-durable/**",
    "playwright-report*/**",
    "test-results*/**",
    ".review/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma 7 rust-free client output (regenerated).
    "generated/**",
    // Vitest coverage report output (gitignored, but eslint would still lint it).
    "coverage/**",
    // Read-only UX design exports include their own bundled browser runtime.
    "docs/ux-redesign/**",
  ]),
]);

export default eslintConfig;
