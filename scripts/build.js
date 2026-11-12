// Build step with esbuild. Output goes to dist/ and is committed, so the pages run without installing anything.
//   dist/core.js        game + ViewModel + sound + file helpers, shared by all views (global: MinesweeperCore)
//   dist/plain-app.js   src/app.js        (plain JavaScript view)
//   dist/vue-app.js     src/vue-app.js    (Vue 3 view, bundled with Vue)
//   dist/react-app.js   src/react-app.jsx (React 18 view, bundled with React)
// Each page loads core.js first, then its own view script. Plain <script> tags (not ES modules) so the pages still
// work when opened straight from disk: browsers block module scripts on file:// pages.
// Run `npm run build` after changing src/ or upgrading a package.
const path = require('path');
const esbuild = require('esbuild');
const root = path.join(__dirname, '..');
const src = f => path.join(root, 'src', f), out = f => path.join(root, 'dist', f);

const common = { bundle: true, minify: true, format: 'iife', jsx: 'automatic', logLevel: 'info',
                 define: { 'process.env.NODE_ENV': '"production"' } }; // React/Vue check this to drop dev-only code

// In a view bundle, imports of the shared files resolve to the core bundle's global instead of being bundled again.
const sharedFromCore = {
  name: 'shared-from-core',
  setup(build) {
    build.onResolve({ filter: /^\.\/(viewmodel|rng|sound|settingsfile)\.js$/ }, args => ({ path: args.path, namespace: 'core' }));
    build.onLoad({ filter: /.*/, namespace: 'core' }, () => ({
      loader: 'js',
      contents: 'export const { ViewModel, cellSize, ACTION_LABELS, LEVEL_NAMES, rngFromSearch, Sound, SettingsFile } = window.MinesweeperCore;',
    }));
  },
};

async function main() {
  await esbuild.build({ ...common, entryPoints: [src('core.js')], outfile: out('core.js'), globalName: 'MinesweeperCore' });
  const view = { ...common, plugins: [sharedFromCore] };
  await esbuild.build({ ...view, entryPoints: [src('app.js')], outfile: out('plain-app.js') });
  await esbuild.build({ ...view, entryPoints: [src('react-app.jsx')], outfile: out('react-app.js') });
  await esbuild.build({
    ...view, entryPoints: [src('vue-app.js')], outfile: out('vue-app.js'),
    alias: { vue: 'vue/dist/vue.esm-bundler.js' }, // the Vue build that includes the template compiler
    define: { ...common.define, __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
  });
}
main().catch(() => process.exit(1));
