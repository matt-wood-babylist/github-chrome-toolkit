import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const watch = process.argv.includes('--watch')
// A build for teammates: no dev harnesses, zipped into release/.
const release = process.argv.includes('--release')

/** Static files copied verbatim into dist/, as [from, to] relative to root/dist. */
const STATIC = [
  ['manifest.json', 'manifest.json'],
  ['icons', 'icons'],
  ['src/options/index.html', 'options.html'],
  ['src/popup/index.html', 'popup.html'],
]

// Dev-only visual harnesses. Neither is referenced by the manifest, so both are
// inert in the loaded extension; open them from dist/dev/ directly. harness.html
// is the banner; popup-harness.html loads the real popup.html against a stubbed
// `chrome`, which is the only way to see that surface without reloading the
// unpacked extension.
const DEV_STATIC = [
  ['dev/harness.html', 'dev/harness.html'],
  ['dev/popup-harness.html', 'dev/popup-harness.html'],
]

async function copyStatic() {
  for (const [from, to] of release ? STATIC : [...STATIC, ...DEV_STATIC]) {
    await cp(resolve(root, from), resolve(dist, to), { recursive: true })
  }
}

const entryPoints = {
  content: resolve(root, 'src/content/index.ts'),
  options: resolve(root, 'src/options/index.ts'),
  popup: resolve(root, 'src/popup/index.ts'),
}
if (!release) entryPoints['dev/harness'] = resolve(root, 'dev/harness.ts')

const options = {
  entryPoints,
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  platform: 'browser',
  // The harness inlines fixture markup as strings.
  loader: { '.html': 'text' },
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
}

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

if (watch) {
  // Re-copy static files on every rebuild so manifest/HTML edits land without a restart.
  const plugin = {
    name: 'copy-static',
    setup: (build) => build.onEnd(copyStatic),
  }
  const ctx = await esbuild.context({ ...options, plugins: [plugin] })
  await ctx.watch()
  console.log('watching… (reload the extension in chrome://extensions after each rebuild)')
} else {
  await esbuild.build(options)
  await copyStatic()
  console.log(`built -> ${dist}`)

  if (release) {
    const { version } = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
    const out = resolve(root, 'release')
    const zip = resolve(out, `github-pending-checks-banner-${version}.zip`)
    await mkdir(out, { recursive: true })
    await rm(zip, { force: true })
    // The system `zip` (macOS and Linux). -X drops extra file attributes so the
    // archive holds only what Chrome reads.
    execFileSync('zip', ['-r', '-X', '-q', zip, '.'], { cwd: dist, stdio: 'inherit' })
    console.log(`packaged -> ${zip}`)
  }
}
