import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
const outfile = 'apple/tools/.build/make-fixtures.cjs';
await build({ entryPoints: ['apple/tools/make-fixtures.ts'], outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning' });
execFileSync('node', [outfile, 'apple/BoltworkKit/Tests/BoltworkKitTests/Fixtures'], { stdio: 'inherit' });
