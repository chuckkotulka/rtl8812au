#!/usr/bin/env node
/* Inlines styles.css, the vendor scripts and app.js into single self-contained files.
   Run: node build.js
     dist/boxly.html          — open it straight off a USB stick, no server needed
     dist/boxly.artifact.html — body-only fragment for hosts that supply their own <head> */

const fs = require('fs');
const path = require('path');

const root = __dirname;
const dist = path.join(root, 'dist');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) =>
  '<style>\n' + read(href).trim() + '\n</style>');

html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
  '<script>\n' + read(src).trim() + '\n</script>');

if (/<(link|script)[^>]+(href|src)="(?!https?:)/.test(html)) {
  console.error('Refusing to write: an external reference survived inlining.');
  process.exit(1);
}

fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'boxly.html'), html);

// Fragment build: keep <title> and the inlined <style>, drop the document scaffolding.
const title = (html.match(/<title>[\s\S]*?<\/title>/) || [''])[0];
const style = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
const body = (html.match(/<body>([\s\S]*)<\/body>/) || ['', ''])[1];
fs.writeFileSync(path.join(dist, 'boxly.artifact.html'), [title, style, body.trim(), ''].join('\n'));

for (const f of ['boxly.html', 'boxly.artifact.html']) {
  const kb = (fs.statSync(path.join(dist, f)).size / 1024).toFixed(0);
  console.log(`dist/${f}  ${kb} KB`);
}
