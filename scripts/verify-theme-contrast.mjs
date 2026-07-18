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
  const linearToSrgb = (value) =>
    value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
  const clamp = (x) => Math.min(1, Math.max(0, x))
  return [r, g, bOut].map((value) => clamp(linearToSrgb(value)))
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
  canvas: [0.844, 0.022, 78],
  surfaceRaised: [0.886, 0.021, 82],
  chassis: [0.848, 0.008, 74],
  textPrimary: [0.2, 0.014, 66],
  textSecondary: [0.32, 0.012, 68],
  textMuted: [0.38, 0.012, 68],
  textDisplay: [0.17, 0.014, 66],
  accentLightness: 0.42,
  accentChroma: 0.095
}

const dark = {
  canvas: [0.135, 0.022, 74],
  surfaceRaised: [0.165, 0.025, 74],
  chassis: [0.165, 0.025, 74],
  textPrimary: [0.86, 0.009, 84],
  textSecondary: [0.84, 0.01, 84],
  textMuted: [0.78, 0.01, 84],
  textDisplay: [0.96, 0.008, 86],
  accentLightness: 0.66,
  accentChroma: 0.1
}

const climates = {
  moss: 148,
  ember: 32,
  slate: 220
}

function composite(foreground, background, alpha) {
  return foreground.map((channel, index) => channel * alpha + background[index] * (1 - alpha))
}

function checkMode(name, climate, accentHue, tokens) {
  const bg = tokens.canvas
  const card = tokens.surfaceRaised
  const chassis = tokens.chassis
  const accent = oklchToRgb(tokens.accentLightness, tokens.accentChroma, accentHue)
  const subtleAccent = composite(accent, oklchToRgb(...card), 0.12)
  const pairs = [
    ['text-primary on canvas', tokens.textPrimary, bg],
    ['text-secondary on canvas', tokens.textSecondary, bg],
    ['text-muted on canvas', tokens.textMuted, bg],
    ['text-display on canvas', tokens.textDisplay, bg],
    ['body text-primary on card', tokens.textPrimary, card],
    ['text-secondary on card', tokens.textSecondary, card],
    ['text-muted on card', tokens.textMuted, card],
    ['chassis-text on chassis', tokens.textPrimary, chassis],
    ['accent link on canvas', [tokens.accentLightness, tokens.accentChroma, accentHue], bg],
    ['accent link on card', [tokens.accentLightness, tokens.accentChroma, accentHue], card],
    ['button text on subtle accent', tokens.textPrimary, subtleAccent, true]
  ]
  let pass = true
  console.log(`\n${name} · ${climate}`)
  for (const [label, fg, bgTok, backgroundIsRgb = false] of pairs) {
    const ratio = contrast(
      oklchToRgb(...fg),
      backgroundIsRgb ? bgTok : oklchToRgb(...bgTok)
    )
    const ok = ratio >= 4.5
    if (!ok) pass = false
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}: ${ratio.toFixed(2)}:1`)
  }
  return pass
}

const results = []
for (const [climate, hue] of Object.entries(climates)) {
  results.push(checkMode('Light mode', climate, hue, light))
  results.push(checkMode('Dark mode', climate, hue, dark))
}
if (results.some((result) => !result)) process.exit(1)
console.log('\nAll semantic text pairs pass WCAG AA across both themes and all climate presets (≥4.5:1).')
