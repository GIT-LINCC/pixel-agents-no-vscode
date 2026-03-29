const esbuild = require('esbuild');

const production = process.argv.includes('--production');

const sharedConfig = {
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  target: 'node20',
  external: ['electron'],
  logLevel: 'silent',
};

async function main() {
  await Promise.all([
    esbuild.build({
      ...sharedConfig,
      entryPoints: ['desktop/main.ts'],
      outfile: 'dist/desktop/main.js',
    }),
    esbuild.build({
      ...sharedConfig,
      entryPoints: ['desktop/preload.ts'],
      outfile: 'dist/desktop/preload.js',
    }),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
