import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    name: 'dsh-desktop-attach',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: true,
    sourcemap: true,
  },
])
