/**
 * Directional light shaft + edge shimmer — not omni aurora.
 * Composites over CSS grid/shaft; alpha capped for instrument-panel feel.
 */
export const heroAmbientFragmentShader = /* glsl */ `
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
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
    -0.577350269189626,
    0.024390243902439
  );
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
  vec2 uv = vUv;
  vec2 focus = vec2(0.3, 0.36);
  vec2 delta = (uv - focus) * vec2(1.12, 0.88);
  float dist = length(delta);

  float shaft = smoothstep(0.78, 0.06, dist);
  shaft *= smoothstep(0.0, 0.62, 1.0 - uv.y + 0.08);
  shaft *= smoothstep(-0.05, 0.42, uv.x + 0.12);

  float t = uTime * 0.032;
  vec2 warpQ = vec2(fbm(uv * 2.4 + vec2(0.0, t * 0.12)), fbm(uv * 2.4 + vec2(5.2, 1.3) + t * 0.08));
  vec2 warpR = vec2(
    fbm(uv * 2.4 + 3.5 * warpQ + vec2(1.7, 9.2)),
    fbm(uv * 2.4 + 3.5 * warpQ + vec2(8.3, 2.8) + t * 0.06)
  );
  float shimmer = snoise(uv * 4.2 + warpR * 0.14 + vec2(t * 0.35, -t * 0.22));
  shaft *= 1.0 + shimmer * 0.038;

  vec3 col = mix(uColorMid, uColorHigh, smoothstep(0.15, 0.88, shaft));
  col = mix(uColorLow, col, shaft);
  col *= shaft * uIntensity;

  float alpha = clamp(length(col) * 1.1, 0.0, 0.22);
  gl_FragColor = vec4(col, alpha);
}
`

export const heroAmbientVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`
