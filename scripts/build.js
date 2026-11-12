// Build step: bundle each view with esbuild into one script, no globals and no CDN (works offline).
//   src/app.js        -> dist/plain-app.js   (plain JavaScript view)
//   src/vue-app.js    -> dist/vue-app.js     (Vue 3 view; esbuild's alias picks Vue's build that includes the template compiler)
//   src/react-app.jsx -> dist/react-app.js   (React 18 view)
// Game, ViewModel, sound and settings code are bundled into each. The outputs are committed, so the pages run
// without installing anything; run `npm run build` after changing src/ or upgrading a package.
const path = require('path');
const esbuild = require('esbuild');
const root = path.join(__dirname, '..');

const common = { bundle: true, minify: true, format: 'iife', jsx: 'automatic', logLevel: 'info',
                 define: { 'process.env.NODE_ENV': '"production"' } }; // React/Vue check this to drop dev-only code
const src = f => path.join(root, 'src', f), out = f => path.join(root, 'dist', f);

esbuild.buildSync({ ...common, entryPoints: [src('app.js')], outfile: out('plain-app.js') });
esbuild.buildSync({ ...common, entryPoints: [src('react-app.jsx')], outfile: out('react-app.js') });
esbuild.buildSync({
  ...common, entryPoints: [src('vue-app.js')], outfile: out('vue-app.js'),
  alias: { vue: 'vue/dist/vue.esm-bundler.js' },
  define: { ...common.define, __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
});
