# Version Method Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose the running engramdb version via an MCP `get_version` tool and a `--version` / `-v` CLI flag.

**Architecture:** A new `src/version.ts` imports `version` from `package.json` (Node JSON import) and exports `VERSION`. `server.ts` registers a `get_version` MCP tool and updates the constructor version string. `index.ts` handles `--version`/`-v` argv flags before starting the transport.

**Tech Stack:** TypeScript, Node16 module resolution, `@modelcontextprotocol/sdk`, `package.json` JSON import.

---

### Task 1: Enable `resolveJsonModule` in tsconfig

**Files:**
- Modify: `tsconfig.json`

**Step 1: Add `resolveJsonModule` to compiler options**

In `tsconfig.json`, add `"resolveJsonModule": true` to `compilerOptions`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 2: Verify tsconfig is valid**

Run: `npx tsc --noEmit`
Expected: No errors (node_modules must be installed first; skip if not installed yet)

**Step 3: Commit**

```bash
git add tsconfig.json
git commit -m "chore: enable resolveJsonModule in tsconfig"
```

---

### Task 2: Create `src/version.ts`

**Files:**
- Create: `src/version.ts`

**Step 1: Create the version module**

```ts
import pkg from '../package.json' with { type: 'json' };
export const VERSION: string = pkg.version;
```

Note: The `with { type: 'json' }` import assertion is required for Node16 ESM JSON imports.

**Step 2: Commit**

```bash
git add src/version.ts
git commit -m "feat: add version module sourced from package.json"
```

---

### Task 3: Add `get_version` MCP tool and update server version string

**Files:**
- Modify: `src/server.ts`

**Step 1: Import VERSION at the top of `src/server.ts`**

Add after the existing imports:

```ts
import { VERSION } from './version.js';
```

**Step 2: Update the McpServer constructor version**

Change line 26 from:
```ts
const server = new McpServer({ name: 'engramdb', version: '0.2.0' });
```
to:
```ts
const server = new McpServer({ name: 'engramdb', version: VERSION });
```

**Step 3: Register the `get_version` tool**

Add this block before `return server;` at the end of `createServer`:

```ts
server.tool(
  'get_version',
  'Get the currently running version of engramdb',
  {},
  () => {
    return { content: [{ type: 'text', text: JSON.stringify({ version: VERSION }) }] };
  }
);
```

**Step 4: Build to verify no type errors**

Run: `npm install && npm run build`
Expected: Compiles cleanly to `dist/` with no errors.

**Step 5: Commit**

```bash
git add src/server.ts
git commit -m "feat: add get_version MCP tool"
```

---

### Task 4: Add `--version` / `-v` CLI flag to `src/index.ts`

**Files:**
- Modify: `src/index.ts`

**Step 1: Import VERSION and add flag handling**

At the top of `src/index.ts`, after the `setup` check block (after line 6), add:

```ts
import { VERSION } from './version.js';

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stdout.write(VERSION + '\n');
  process.exit(0);
}
```

The full top of the file should look like:

```ts
#!/usr/bin/env node
if (process.argv[2] === 'setup') {
  const { runSetup } = await import('./setup.js')
  await runSetup()
  process.exit(0)
}

import { VERSION } from './version.js';

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stdout.write(VERSION + '\n');
  process.exit(0);
}
```

**Step 2: Build**

Run: `npm run build`
Expected: Compiles cleanly.

**Step 3: Smoke test the CLI flag**

Run: `node dist/index.js --version`
Expected output: `0.2.1`

Run: `node dist/index.js -v`
Expected output: `0.2.1`

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add --version / -v CLI flag"
```

---

### Task 5: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 2: Verify MCP tool appears in server registration (optional smoke test)**

The tool is registered; no automated test required. The build success and existing test suite are sufficient.
