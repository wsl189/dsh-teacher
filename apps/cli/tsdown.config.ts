import { defineConfig } from 'tsdown'

/** CLI, profile launcher, and IPC backend entries; declarations come from tsc. */
export default defineConfig({
  entry: ['lib/types/bin.js', 'lib/types/profile-boot.js', 'lib/types/desktop-backend.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: ['lib/*.js'],
})
