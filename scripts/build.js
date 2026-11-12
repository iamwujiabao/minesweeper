// Build step: put Vue and React next to the game so the pages work offline (no CDN).
//  - vendor/vue.global.prod.js : Vue's ready-made browser build, copied from node_modules
//  - dist/react-app.js         : src/react-app.jsx + React + ReactDOM bundled into one script by esbuild
// The outputs are committed, so you only need `npm run build` after changing react-app.jsx or upgrading a package.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const root = path.join(__dirname, '..');

fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
fs.copyFileSync(require.resolve('vue/dist/vue.global.prod.js'), path.join(root, 'vendor', 'vue.global.prod.js'));

esbuild.buildSync({
  entryPoints: [path.join(root, 'src/react-app.jsx')],
  outfile: path.join(root, 'dist/react-app.js'),
  bundle: true, minify: true, format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, // React checks this to drop dev-only code
  logLevel: 'info',
});
