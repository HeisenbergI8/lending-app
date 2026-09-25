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
    // Agent working files, not source. The architect's plan reviews under
    // .claude/plans/*/references/ are ANNOTATED EXCERPTS saved with .ts and
    // .tsx extensions — deliberately partial, so they do not parse. Linting
    // them turns every plan directory into seven parse errors and makes
    // `npm run verify` red for a reason that has nothing to do with the app.
    ".claude/**",
  ]),
]);

export default eslintConfig;
