// One-time prep step for the .tsx sandbox preview (Run button, EditorLayout.tsx
// buildReactSandboxHtml). Copies prebuilt UMD/standalone JS out of the aliased
// devDependencies (react-sandbox-vendor/react-dom-sandbox-vendor pin React 18,
// the last major to publish UMD builds — React 19 dropped them) into
// resources/vendor, following the same "populate resources/ locally before
// packaging" pattern as resources/models and resources/runtimes.
const fs = require('fs');
const path = require('path');

const copies = [
  {
    from: 'node_modules/react-sandbox-vendor/umd/react.production.min.js',
    to: 'resources/vendor/react.production.min.js',
  },
  {
    from: 'node_modules/react-dom-sandbox-vendor/umd/react-dom.production.min.js',
    to: 'resources/vendor/react-dom.production.min.js',
  },
  {
    from: 'node_modules/@babel/standalone/babel.min.js',
    to: 'resources/vendor/babel.min.js',
  },
];

fs.mkdirSync(path.join(__dirname, '..', 'resources', 'vendor'), { recursive: true });

for (const { from, to } of copies) {
  const src = path.join(__dirname, '..', from);
  const dest = path.join(__dirname, '..', to);
  fs.copyFileSync(src, dest);
  console.log(`Copied ${from} -> ${to}`);
}
