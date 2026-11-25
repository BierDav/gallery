const esbuild = require('esbuild');
const fs = require('node:fs');
fs.mkdirSync('dist', {recursive: true});
esbuild.buildSync({entryPoints: ['src/index.cjs'], outfile: 'dist/index.js', bundle: true, format: 'cjs', target: 'es2020'});
fs.writeFileSync('dist/index.d.ts', `declare module 'extism:host' { interface user { httpRequest(ptr: PTR): I64; } }\ndeclare module 'main' { export function sortUpload(): I32; }\n`);
