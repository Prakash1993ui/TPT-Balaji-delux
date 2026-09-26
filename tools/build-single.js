#!/usr/bin/env node
/*
 * Builds standalone/tpt-balaji-delux.html — the whole app in ONE file
 * (CSS, JavaScript and icons inlined). Double-click it to open in any browser:
 * no server or internet needed. Data is saved in that browser on that device.
 *
 *   node tools/build-single.js      (or: npm run build:single)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const dataUri = (p, mime) => `data:${mime};base64,${fs.readFileSync(path.join(root, p)).toString('base64')}`;
// Inline scripts must not contain "</script" or "<!--" sequences
const safeScript = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

let html = read('index.html');
const scripts = [];
html = html.replace(/\s*<script defer src="([^"]+)"><\/script>/g, (m, src) => {
  scripts.push(`<script>/* ${src} */\n${safeScript(read(src))}\n</script>`);
  return '';
});
html = html
  .replace(/<link rel="stylesheet" href="([^"]+)" \/>/, (m, href) => `<style>\n${read(href)}\n</style>`)
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/<link rel="icon" href="icons\/favicon.svg"[^>]*>/, () => `<link rel="icon" href="${dataUri('icons/favicon.svg', 'image/svg+xml')}" type="image/svg+xml" />`)
  .replace(/\s*<link rel="icon" href="icons\/icon-192.png"[^>]*>/, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>/, () => `<link rel="apple-touch-icon" href="${dataUri('icons/apple-touch-icon.png', 'image/png')}" />`)
  .replace(/\s*<!-- (Libraries|App)[^>]*-->/g, '')
  .replace('<!--TBD_SERVER-->', '<!-- single-file build -->')
  // (function replacements: minified code contains "$&"-style sequences that string replacements would expand)
  .replace('</body>', () => `${scripts.join('\n')}\n</body>`);

const outDir = path.join(root, 'standalone');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'tpt-balaji-delux.html');
fs.writeFileSync(out, html);
console.log(`Built ${path.relative(root, out)} (${Math.round(html.length / 1024)} KB, ${scripts.length} scripts inlined)`);
