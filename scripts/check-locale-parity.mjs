/**
 * Verify that every locale dictionary has identical zh/en shapes.
 * Bundles src/lib/locales/*.ts with esbuild first (see package.json-free usage below).
 *
 *   npm run i18n:check
 */
import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const DIR = process.argv[2] ?? '/tmp/locales'
let problems = 0

function shape(value, path = '') {
  // Arrays are compared by element type only: locale pools may differ in length
  // (e.g. Chinese name pool vs English name pool).
  // Arrays: compare the element key signature, never the length. Locale data
  // pools differ in size (zh name pool vs en name pool) and unused branches are
  // intentionally empty.
  if (Array.isArray(value)) {
    const objs = value.filter(v => v && typeof v === 'object' && !Array.isArray(v))
    if (objs.length) return `array<${Object.keys(objs[0]).sort().join('+')}>`
    const nested = value.find(v => Array.isArray(v))
    if (nested) return `array<${shape(nested, path)}>`
    return 'array'
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .map(k => `${k}:${shape(value[k], `${path}.${k}`)}`)
      .join(',')
  }
  return typeof value
}

for (const file of readdirSync(DIR).filter(f => f.endsWith('.mjs'))) {
  const mod = await import(pathToFileURL(`${DIR}/${file}`).href)
  for (const [name, value] of Object.entries(mod)) {
    if (!value || typeof value !== 'object' || !('zh' in value) || !('en' in value)) continue
    const zhShape = shape(value.zh)
    const enShape = shape(value.en)
    if (zhShape === enShape) continue
    problems++
    console.log(`\n[SHAPE MISMATCH] ${file} -> ${name}`)
    const zhKeys = new Set(zhShape.split(/[,:]/))
    const enKeys = new Set(enShape.split(/[,:]/))
    const onlyZh = [...zhKeys].filter(k => !enKeys.has(k))
    const onlyEn = [...enKeys].filter(k => !zhKeys.has(k))
    if (onlyZh.length) console.log('  zh only:', onlyZh.join(', '))
    if (onlyEn.length) console.log('  en only:', onlyEn.join(', '))
    console.log('  zh:', zhShape.slice(0, 300))
    console.log('  en:', enShape.slice(0, 300))
  }
}

console.log(problems === 0 ? '\nOK: all locale dictionaries are shape-identical' : `\n${problems} mismatch(es)`)
process.exit(problems === 0 ? 0 : 1)
