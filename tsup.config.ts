import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', react: 'src/react.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['react', '@dexterai/vault', '@simplewebauthn/browser'],
});
