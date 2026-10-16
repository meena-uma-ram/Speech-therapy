// Bundles index.html + CSS + JS into one self-contained file: therapy-planner.html
// Usage: node scripts/build-single.js [--fragment out.html]
//   --fragment writes the page without <html>/<head>/<body> wrappers (for hosts that add their own).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const html = read('index.html');
const css = read('css/styles.css');
const js = ['js/logic.js', 'js/store.js', 'js/app.js'].map(read).join('\n');
const fonts = html.match(/<link rel="preconnect"[\s\S]*?display=swap">/)[0];
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script')).trim();

const fragIdx = process.argv.indexOf('--fragment');
if (fragIdx > -1) {
  const out = [
    '<title>Therapy Planner</title>',
    '<meta name="claude:viewport-fit-sides" content="cover">',
    fonts,
    '<style>\n' + css + '\n</style>',
    body,
    '<script>\n' + js + '\n</script>'
  ].join('\n');
  fs.writeFileSync(process.argv[fragIdx + 1], out);
  console.log('wrote', process.argv[fragIdx + 1]);
} else {
  const out = html
    .replace('<link rel="stylesheet" href="css/styles.css">', '<style>\n' + css + '\n</style>')
    .replace(/<script src="js\/logic\.js"><\/script>\s*<script src="js\/store\.js"><\/script>\s*<script src="js\/app\.js"><\/script>/,
      () => '<script>\n' + js + '\n</script>');
  fs.writeFileSync(path.join(root, 'therapy-planner.html'), out);
  console.log('wrote therapy-planner.html');
}
