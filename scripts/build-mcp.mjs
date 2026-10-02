import { build } from 'esbuild';

// Bundles the stdio MCP server into one file with no runtime dependencies: apps/mcp/dist/stdio.js.
const outfile = process.argv[2] ?? 'apps/mcp/dist/stdio.js';
await build({
  entryPoints: ['apps/mcp/src/stdio.ts'], outfile, bundle: true, platform: 'node', target: 'node22', format: 'esm', minify: false, legalComments: 'none',
  // CommonJS dependencies inside an ES module bundle still need require().
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __ledgerRequire } from 'node:module';\nconst require = __ledgerRequire(import.meta.url);" },
  logLevel: 'warning',
});
console.error(`built ${outfile}`);
