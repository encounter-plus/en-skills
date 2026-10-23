import { transform } from 'esbuild';
import { gzipSync } from 'node:zlib';

// Obfuscation for distribution, not encryption or a security boundary.
export async function packWebview(renderer, injected, exports, rendererInjected) {
  const options = { minify: true, legalComments: 'none', sourcemap: false, target: 'es2022' };
  // Kotlin's builder contains executable source inside strings. Minifying the
  // outer module alone leaves those strings readable, so encode the whole
  // browser payload as well. Decode UTF-8 explicitly to preserve author strings.
  async function encode(script) {
    const minified = (await transform(script, options)).code;
    return `(0,eval)(new TextDecoder().decode(Uint8Array.from(atob('${Buffer.from(minified).toString('base64')}'),c=>c.charCodeAt(0))));\n`;
  }
  const runtime = await encode(injected);
  // The Kotlin browser asset installs the outer module; its renderer builder
  // returns the inner runtime. Keep these distinct, just as upstream does.
  const builtRuntime = rendererInjected === injected ? runtime : await encode(rendererInjected);
  const compiled = (await transform(renderer, { ...options, format: 'esm' })).code;
  const payload = gzipSync(compiled).toString('base64');
  const names = exports.filter(name => name !== 'buildInjectedJs');
  if (!names.every(name => /^[a-zA-Z_$][\w$]*$/.test(name))) throw new Error('Invalid renderer export');
  const packed = `import{gunzipSync as z}from'node:zlib';const m=await import('data:text/javascript;base64,'+z(Buffer.from('${payload}','base64')).toString('base64'));export const {${names.join(',')}}=m;export const buildInjectedJs=()=>${JSON.stringify(builtRuntime)};\n`;
  return { renderer: packed, injected: runtime };
}
