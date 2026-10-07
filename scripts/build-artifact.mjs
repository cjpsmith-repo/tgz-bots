// Pack the Vite build (dist/) into one self-contained HTML file for publishing.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const css = [...html.matchAll(/href="\.\/(assets\/[^"]+\.css)"/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8'));
const js = [...html.matchAll(/src="\.\/(assets\/[^"]+\.js)"/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8'));
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)?.[0] ?? '';
const safeJs = js.join('\n').replace(/<\/script/gi, '<\\/script');
const page = `<title>TGZ Solo</title>
${fonts}
<style>${css.join('\n')}</style>
<div id="app"></div>
<script type="module">${safeJs}</script>
`;
mkdirSync('dist-artifact', { recursive: true });
writeFileSync('dist-artifact/tgz-solo.html', page);
console.log(`dist-artifact/tgz-solo.html: ${(page.length / 1024).toFixed(1)} KB`);
