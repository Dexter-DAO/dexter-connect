import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', react: 'src/react.ts', worldid: 'src/worldid.tsx' },
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['react', '@dexterai/vault', '@simplewebauthn/browser', '@solana/web3.js', '@worldcoin/idkit'],
});
