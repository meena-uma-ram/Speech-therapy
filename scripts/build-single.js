// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Meenakshi Ramesh. Additional terms under AGPL section 7 (author credit): see NOTICE.
// Bundles index.html + CSS + JS into one self-contained file: tjs.html
// Usage: node scripts/build-single.js [--fragment out.html]
//   --fragment writes the page without <html>/<head>/<body> wrappers (for hosts that add their own).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const html = read('index.html');
const css = read('css/styles.css');
const js = ['js/logic.js', 'js/sync.js', 'js/regions.js', 'js/consent.js', 'js/store.js', 'js/app.js'].map(read).join('\n');
const fontMatch = html.match(/<link rel="preconnect"[\s\S]*?display=swap">/);
const fonts = fontMatch ? fontMatch[0] : '';
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script')).trim();

const fragIdx = process.argv.indexOf('--fragment');
if (fragIdx > -1) {
  const out = [
    '<title>TJS</title>',
    '<meta name="claude:viewport-fit-sides" content="cover">',
    '<meta name="referrer" content="no-referrer">',
    fonts,
    '<style>\n' + css + '\n</style>',
    body,
    '<script>\n' + js + '\n</script>'
  ].join('\n');
  fs.writeFileSync(process.argv[fragIdx + 1], out);
  console.log('wrote', process.argv[fragIdx + 1]);
} else {
  const icon = 'data:image/svg+xml;base64,' + Buffer.from(read('icons/icon.svg')).toString('base64');
  const out = html
    .replace(/  <link rel="manifest"[^>]*>\n/, '')
    .replace(/  <link rel="apple-touch-icon"[^>]*>\n/, '')
    .replace('href="icons/icon.svg"', 'href="' + icon + '"')
    .replace('<link rel="stylesheet" href="css/styles.css">', '<style>\n' + css + '\n</style>')
    .replace(/<script src="js\/logic\.js"><\/script>\s*<script src="js\/sync\.js"><\/script>\s*<script src="js\/regions\.js"><\/script>\s*<script src="js\/consent\.js"><\/script>\s*<script src="js\/store\.js"><\/script>\s*<script src="js\/app\.js"><\/script>/,
      () => '<script>\n' + js + '\n</script>');
  fs.writeFileSync(path.join(root, 'tjs.html'), out);
  console.log('wrote tjs.html');
}
