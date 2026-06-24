/**
 * Color utility functions for DLC labeler.
 * Generates colors for bodypart labeling using various color palettes.
 */

/**
 * Convert HSV to RGB.
 * h in [0,1], s in [0,1], v in [0,1]
 * Returns {r, g, b} in [0,255]
 */
function hsvToRgb(h, s, v) {
  let r, g, b
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)

  switch (i % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    case 5: r = v; g = p; b = q; break
    default: r = 0; g = 0; b = 0
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  }
}

/**
 * Convert r,g,b (0-255) to CSS hex string.
 */
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate N evenly-spaced rainbow colors using HSV(i/N, 1, 1).
 * Returns an array of CSS hex color strings.
 */
export function generateRainbowColors(n) {
  if (n === 0) return []
  return Array.from({ length: n }, (_, i) => {
    const h = i / n
    const { r, g, b } = hsvToRgb(h, 1, 1)
    return rgbToHex(r, g, b)
  })
}

/**
 * Viridis-like palette: interpolated between key colors.
 */
function viridisColor(t) {
  // Key colors from matplotlib viridis at t=0,0.25,0.5,0.75,1.0
  const stops = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ]
  const scaled = t * (stops.length - 1)
  const idx = Math.min(Math.floor(scaled), stops.length - 2)
  const frac = scaled - idx
  const [r1, g1, b1] = stops[idx]
  const [r2, g2, b2] = stops[idx + 1]
  return rgbToHex(
    Math.round(r1 + frac * (r2 - r1)),
    Math.round(g1 + frac * (g2 - g1)),
    Math.round(b1 + frac * (b2 - b1))
  )
}

/**
 * Plasma-like palette.
 */
function plasmaColor(t) {
  const stops = [
    [13, 8, 135],
    [126, 3, 168],
    [204, 71, 120],
    [248, 149, 64],
    [240, 249, 33],
  ]
  const scaled = t * (stops.length - 1)
  const idx = Math.min(Math.floor(scaled), stops.length - 2)
  const frac = scaled - idx
  const [r1, g1, b1] = stops[idx]
  const [r2, g2, b2] = stops[idx + 1]
  return rgbToHex(
    Math.round(r1 + frac * (r2 - r1)),
    Math.round(g1 + frac * (g2 - g1)),
    Math.round(b1 + frac * (b2 - b1))
  )
}

/**
 * Cool palette (cyan to magenta).
 */
function coolColor(t) {
  // cyan (0,255,255) -> magenta (255,0,255)
  return rgbToHex(
    Math.round(t * 255),
    Math.round((1 - t) * 255),
    255
  )
}

/**
 * Warm palette (yellow to red).
 */
function warmColor(t) {
  // yellow (255,255,0) -> red (255,0,0)
  return rgbToHex(
    255,
    Math.round((1 - t) * 255),
    0
  )
}

/**
 * Blues palette (light to dark blue).
 */
function bluesColor(t) {
  // light blue (198,219,239) -> dark blue (8,48,107)
  const r1 = 198, g1 = 219, b1 = 239
  const r2 = 8, g2 = 48, b2 = 107
  return rgbToHex(
    Math.round(r1 + t * (r2 - r1)),
    Math.round(g1 + t * (g2 - g1)),
    Math.round(b1 + t * (b2 - b1))
  )
}

/**
 * Generate N colors from a named palette.
 * Supported palette names: rainbow, viridis, plasma, cool, warm, blues
 */
export function generatePaletteColors(paletteName, n) {
  if (n === 0) return []
  if (paletteName === 'rainbow') return generateRainbowColors(n)

  const colorFn = {
    viridis: viridisColor,
    plasma: plasmaColor,
    cool: coolColor,
    warm: warmColor,
    blues: bluesColor,
  }[paletteName]

  if (!colorFn) return generateRainbowColors(n)

  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1)
    return colorFn(t)
  })
}
