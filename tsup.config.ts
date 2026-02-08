import { defineConfig } from "tsup";

export default defineConfig([
	// MCP Server entry
	{
		entry: ["src/index.ts"],
		format: ["esm"],
		target: "node22",
		outDir: "dist",
		clean: true,
		sourcemap: true,
		dts: true,
		shims: true,
		noExternal: [],
		external: ["better-sqlite3"],
		banner: {
			js: "#!/usr/bin/env node\nimport { createRequire } from 'module'; const require = createRequire(import.meta.url);",
		},
	},
	// CLI entry
	{
		entry: ["src/cli.ts"],
		format: ["esm"],
		target: "node22",
		outDir: "dist",
		clean: false,
		sourcemap: true,
		dts: false,
		shims: true,
		banner: {
			js: "#!/usr/bin/env node",
		},
	},
]);
