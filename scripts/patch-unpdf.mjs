// Patches unpdf's bundled pdfjs.mjs to properly load @napi-rs/canvas
// instead of using a Proxy stub that always throws.
// This is needed because unpdf's build process strips out the require() call.
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dirname, '../node_modules/unpdf/dist/pdfjs.mjs');

try {
  let content = readFileSync(target, 'utf8');
  
  const broken = '_createCanvas(e,n){return process.getBuiltinModule("module").createRequire(import.meta.url),new Proxy({},{get(i,a){return()=>{throw new Error("@napi-rs/canvas is not available in this environment")}}}).createCanvas(e,n)}';
  
  const fixed = '_createCanvas(e,n){try{const mod=process.getBuiltinModule("module").createRequire(import.meta.url)("@napi-rs/canvas");return mod.createCanvas(e,n)}catch{throw new Error("@napi-rs/canvas is not available in this environment")}}';
  
  if (content.includes(broken)) {
    content = content.replace(broken, fixed);
    writeFileSync(target, content);
    console.log('[patch-unpdf] ✅ Patched NodeCanvasFactory to load @napi-rs/canvas properly');
  } else if (content.includes('try{const mod=process.getBuiltinModule')) {
    console.log('[patch-unpdf] ✅ Already patched');
  } else {
    console.warn('[patch-unpdf] ⚠️ Could not find pattern to patch — unpdf version may have changed');
  }
} catch (e) {
  console.warn(`[patch-unpdf] ⚠️ Patch skipped: ${e.message}`);
}
