/**
 * Stage ambient — a very slow, warm, low-contrast light drift behind the whole
 * app canvas (the "premium version of the static --moss-stage-bg" per
 * MOSS_DESIGN_IDENTITY §4). Domain-warped noise, capped to a whisper of alpha so
 * it reads as breathing warmth, never an aurora. Full-motion only; the baked
 * static newsprint + CSS washes are the reduced/off fallback.
 */
export const stageAmbientFragmentShader = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uIntensity;
uniform vec3 uColorLow;
uniform vec3 uColorMid;
uniform vec3 uColorHigh;

varying vec2 vUv;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 3; i++) {
    v += a * snoise(p);
    p = rot * p * 2.02 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  // Rotate the noise domain off the screen axes and sample at a higher
  // frequency: at ~1.3 cells per screen the simplex lattice itself became
  // visible as a giant triangle/hexagon blotch (QA, 2026-07-02). More cells
  // + rotation + a softer curve keep it formless.
  vec2 uv = mat2(0.891, -0.454, 0.454, 0.891) * vUv;
  float t = uTime * 0.012;

  vec2 warp = vec2(
    fbm(uv * 2.1 + vec2(0.0, t)),
    fbm(uv * 2.1 + vec2(3.1, -t * 0.8))
  );
  float field = fbm(uv * 2.6 + warp * 0.55 + vec2(t * 0.18, -t * 0.12));
  field = smoothstep(-0.85, 1.05, field);

  // Warmth pools toward the top-left, like light through a window —
  // screen-aligned, so it stays on the unrotated coordinates.
  float grad = smoothstep(1.15, -0.1, vUv.y + vUv.x * 0.18);
  float amt = field * grad;

  vec3 col = mix(uColorLow, uColorMid, smoothstep(0.15, 0.65, amt));
  col = mix(col, uColorHigh, smoothstep(0.55, 1.0, amt));

  float alpha = clamp(amt * uIntensity, 0.0, 0.13);
  gl_FragColor = vec4(col, alpha);
}
`

export const stageAmbientVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`
