#!/usr/bin/env node
/** WCAG AA check for MOSS semantic text/background pairs (oklch tokens). */

function oklchToRgb(l, c, h) {
  const hRad = (h * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const l3 = l_ ** 3
  const m3 = m_ ** 3
  const s3 = s_ ** 3
  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const bOut = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
  const clamp = (x) => Math.min(1, Math.max(0, x))
  return [clamp(r), clamp(g), clamp(bOut)]
}

function relLuminance([r, g, b]) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a, b) {
  const l1 = relLuminance(a)
  const l2 = relLuminance(b)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

const light = {
  canvas: [0.84, 0.014, 74],
  surfaceRaised: [0.882, 0.013, 78],
  chassis: [0.848, 0.008, 74],
  textPrimary: [0.2, 0.014, 66],
  textSecondary: [0.32, 0.012, 68],
  textMuted: [0.38, 0.012, 68],
  textDisplay: [0.17, 0.014, 66]
}

const dark = {
  canvas: [0.1, 0.009, 74],
  surfaceRaised: [0.13, 0.01, 74],
  chassis: [0.13, 0.01, 74],
  textPrimary: [0.86, 0.009, 84],
  textSecondary: [0.8, 0.01, 84],
  textMuted: [0.78, 0.01, 84],
  textDisplay: [0.96, 0.008, 86]
}

function checkMode(name, tokens) {
  const bg = oklchToRgb(...tokens.canvas)
  const card = oklchToRgb(...tokens.surfaceRaised)
  const chassis = oklchToRgb(...tokens.chassis)
  const pairs = [
    ['text-primary on canvas', tokens.textPrimary, bg],
    ['text-secondary on canvas', tokens.textSecondary, bg],
    ['text-muted on canvas', tokens.textMuted, bg],
    ['text-display on canvas', tokens.textDisplay, bg],
    ['text-primary on card', tokens.textPrimary, card],
    ['text-muted on card', tokens.textMuted, card],
    ['chassis-text on chassis', tokens.textPrimary, chassis]
  ]
  let pass = true
  console.log(`\n${name}`)
  for (const [label, fg, bgTok] of pairs) {
    const ratio = contrast(oklchToRgb(...fg), oklchToRgb(...bgTok))
    const ok = ratio >= 4.5
    if (!ok) pass = false
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}: ${ratio.toFixed(2)}:1`)
  }
  return pass
}

const lightOk = checkMode('Light mode', light)
const darkOk = checkMode('Dark mode', dark)
if (!lightOk || !darkOk) process.exit(1)
console.log('\nAll WCAG AA body-text pairs pass (≥4.5:1).')
