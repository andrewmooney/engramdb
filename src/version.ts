// ESM (type:module) cannot import JSON without an import assertion in Node 22;
// createRequire is the idiomatic workaround.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
export const VERSION: string = pkg.version;
