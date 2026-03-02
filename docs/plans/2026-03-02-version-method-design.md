# Design: Version Method

**Date:** 2026-03-02

## Goal

Expose the currently running engramdb version in two places:
1. As an MCP tool (`get_version`) callable by AI agents
2. As a CLI flag (`--version` / `-v`)

## Version Source

A new `src/version.ts` module imports `version` from `package.json` and re-exports it as `VERSION`. This is the single source of truth — no duplication with `package.json`.

```ts
import pkg from '../package.json' with { type: 'json' };
export const VERSION = pkg.version;
```

`tsconfig.json` requires `"resolveJsonModule": true`.

## MCP Tool: `get_version`

- **Name:** `get_version`
- **Description:** Get the currently running version of engramdb
- **Input:** none
- **Output:** `{ "version": "0.2.1" }`
- Registered in `src/server.ts` alongside existing tools
- The `McpServer` constructor version string updated to use `VERSION`

## CLI Flag

In `src/index.ts`, before transport setup, check `process.argv` for `--version` or `-v`. If found, print the version to stdout and exit 0.

```
$ engramdb --version
0.2.1
```

## Files Changed

| File | Change |
|------|--------|
| `src/version.ts` | New — exports `VERSION` from `package.json` |
| `src/server.ts` | Import `VERSION`, add `get_version` tool, update constructor version |
| `src/index.ts` | Add `--version` / `-v` CLI flag handling |
| `tsconfig.json` | Add `resolveJsonModule: true` if not present |

## Testing

No new tests — version reading is trivial. Existing test suite covers tool registration.
