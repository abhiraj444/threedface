export const UPDATE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aVel;
layout(location = 2) in vec3 aHome;
layout(location = 3) in float aSeed;
uniform float uDt, uTime, uSpring, uDamp, uAssemble, uTurb;
uniform vec4 uTouch[5];
uniform vec2 uTouchVel[5];
uniform float uMode;
uniform float uEffectT;
uniform float uEffectAmp;
uniform vec2 uEffectOrigin;
out vec3 vPos;
out vec3 vVel;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash(i);
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

vec3 curlNoise(vec3 p) {
  float n1 = vnoise(p);
  float n2 = vnoise(p + vec3(17.1, 31.7, 9.4));
  float n3 = vnoise(p + vec3(5.2, 41.3, 23.8));
  return vec3(n2 - 0.5, n3 - 0.5, n1 - 0.5);
}

void main() {
  vec3 f = vec3(0.0);

  // Mode 5: Celestial Fill / Stream
  // Particles cascade down in individual fluid streams with staggered arrival and settle layer-by-layer
  if (uMode > 4.5) {
    float stagger = aSeed * 0.28;
    float reach = smoothstep(uEffectT - 0.16 + stagger, uEffectT + 0.10 + stagger, aHome.y);
    vec3 springForce = (aHome - aPos) * (uSpring * 1.85);
    // Dispersed stream with individual lateral drift and vertical descent velocity
    float sway = sin(uTime * 4.5 + aSeed * 32.0) * 0.25;
    float streamZ = (aHome.z - aPos.z) * 4.5;
    vec3 streamForce = vec3(
      (aHome.x - aPos.x) * 4.5 + sway,
      -2.4 - aSeed * 1.2,
      streamZ
    );
    f += mix(streamForce, springForce, reach);
  } else {
    // Standard harmonic spring with per-particle staggered emergence
    float k = smoothstep(aSeed * 0.45, aSeed * 0.45 + 0.55, uAssemble);
    f += (aHome - aPos) * (uSpring * (0.65 + 0.70 * k));
  }

  // Multi-touch interactive repulsion and velocity injection
  for (int i = 0; i < 5; i++) {
    vec2 d = aPos.xy - uTouch[i].xy;
    float rz = max(uTouch[i].z, 0.0001);
    float g = exp(-dot(d, d) / (rz * rz));
    vec2 nrm = d * inversesqrt(dot(d, d) + 1e-6);
    f.xy += nrm * g * uTouch[i].w;
    f.xy += uTouchVel[i] * g * 2.0;
  }

  // Base ambient 3D curl turbulence field (gentle, organic micro-motion)
  f += curlNoise(aPos * 0.85 + vec3(0.0, uTime * 0.12, uTime * 0.09)) * uTurb;

  // Mode 1: Vortex / Spiral
  // True particle-level tangential velocity + inward/outward spiral orbit around origin
  if (uMode > 0.5 && uMode < 1.5) {
    vec2 delta = aPos.xy - uEffectOrigin;
    float r = length(delta);
    if (r > 0.001) {
      vec2 tangent = vec2(-delta.y, delta.x) / r;
      vec2 radial = -delta / r;
      float falloff = 1.0 / (1.0 + r * 2.5);
      // Particle phase variation creates individual orbiting streamers rather than rigid rotation
      float particlePhase = sin(r * 12.0 - uTime * 6.0 + aSeed * 6.28) * 0.35;
      f.xy += (tangent * 4.2 + radial * (1.2 + particlePhase)) * uEffectAmp * falloff;
      f.z += sin(r * 8.0 + aSeed * 10.0) * uEffectAmp * 0.5 * falloff;
    }
  }
  // Mode 2: Traveling Harmonic Wave
  // A true traveling sinusoidal wave across the particle field
  else if (uMode > 1.5 && uMode < 2.5) {
    float waveFront = uEffectOrigin.x; // moves smoothly from left to right
    float distToFront = aPos.x - waveFront;
    // Traveling pulse envelope (Gaussian bell)
    float envelope = exp(-pow(distToFront * 3.2, 2.0));
    // High-frequency per-particle harmonic undulation along normal (Z) and lateral (Y)
    float phase = distToFront * 14.0 - uTime * 8.0 + aSeed * 4.0;
    f.z += sin(phase) * (uEffectAmp * 2.6) * envelope;
    f.y += cos(phase * 0.7) * (uEffectAmp * 1.2) * envelope;
    f.x += sin(phase * 0.5) * (uEffectAmp * 0.8) * envelope;
  }
  // Mode 3: Resonance Ripple
  // Concentric spherical wave front expanding from impact origin
  else if (uMode > 2.5 && uMode < 3.5) {
    vec3 d = aPos - vec3(uEffectOrigin, 0.0);
    float dist = length(d);
    float waveRadius = uEffectT * 1.85;
    float ring = exp(-pow((dist - waveRadius) * 8.0, 2.0));
    // Particle-level displacement outward and in Z
    vec3 dir = dist > 1e-4 ? d / dist : vec3(0.0, 0.0, 1.0);
    float crest = sin((dist - waveRadius) * 22.0 + aSeed * 2.0);
    f += dir * (ring * crest * uEffectAmp * 3.8);
    f.z += ring * (uEffectAmp * 2.2) * (1.0 + aSeed);
  }
  // Mode 4: Disassemble / Break
  // Micro-burst explosion with unique particle velocities, swirl, and deep dispersal
  else if (uMode > 3.5 && uMode < 4.5) {
    vec3 d = aPos - vec3(uEffectOrigin, 0.0);
    float dist = length(d);
    vec3 dir = dist > 1e-4 ? normalize(d) : vec3(0.0, 0.0, 1.0);
    // Each particle has its own unique chaotic expulsion vector using curl noise + seed
    vec3 chaoticSpur = curlNoise(aPos * 2.2 + vec3(aSeed * 10.0, uTime * 0.4, aSeed * 5.0));
    float forceFalloff = 1.0 / (dist + 0.35);
    f += (dir * 1.6 + chaoticSpur * 3.2) * uEffectAmp * forceFalloff * (0.6 + aSeed * 0.8);
  }

  vVel = (aVel + f * uDt) * exp(-uDamp * uDt);
  vPos = aPos + vVel * uDt;
}
`;

export const UPDATE_FS = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() { fragColor = vec4(0.0); }
`;

export const RENDER_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aTone;
layout(location = 2) in float aSeed;
layout(location = 3) in vec3 aColor;
uniform mat4 uViewProj;
uniform float uSize;
uniform float uDpr;
uniform vec2 uPointRange;
uniform float uTime;
uniform float uBreath;
uniform float uColorMode;
uniform float uColorMix;
uniform float uInvert;
out float vBright;
out vec3 vColor;

void main() {
  vec3 p = aPos;
  p.z += sin(uTime * 1.35 + aSeed * 6.28318) * uBreath;
  gl_Position = uViewProj * vec4(p, 1.0);
  float depthScale = 0.72 + 0.28 * (1.0 - clamp(p.z * 0.85 + 0.35, 0.0, 1.0));
  float size = uSize * uDpr * depthScale;
  gl_PointSize = clamp(size, uPointRange.x, uPointRange.y);
  float tone = aTone;
  // In invert mode, ensure dark features have solid ink opacity (no hazy fading)
  vBright = uInvert > 0.5
    ? (0.76 + 0.24 * tone) * (0.86 + 0.14 * depthScale)
    : (0.58 + 0.42 * tone) * (0.82 + 0.18 * depthScale);

  // 0.0 = Monochrome (all B&W/silver), 1.0 = Full Color (source image), 2.0 = Hybrid (mixed color + B&W)
  vec3 col;
  vec3 vividColor = aColor;

  if (uColorMode < 0.5) {
    col = vec3(1.0);
  } else if (uColorMode < 1.5) {
    col = vividColor;
  } else {
    float isCol = step(aSeed, clamp(uColorMix, 0.05, 0.95));
    col = mix(vec3(1.0), vividColor, isCol);
  }

  if (uInvert > 0.5) {
    // For inverted mode on fine-art paper:
    // - Monochrome: Rich sumi/carbon black ink
    // - Full Color: High-saturation print pigment derived from source
    // - Hybrid: Interwoven carbon ink + source color pigment
    vec3 inkBlack = vec3(0.04, 0.04, 0.05);
    vec3 richColor = clamp(pow(aColor, vec3(1.1)) * 0.95, 0.0, 1.0);
    if (uColorMode < 0.5) {
      col = inkBlack;
    } else if (uColorMode < 1.5) {
      col = richColor;
    } else {
      float isCol = step(aSeed, clamp(uColorMix, 0.05, 0.95));
      col = mix(inkBlack, richColor, isCol);
    }
  }
  vColor = col;
}
`;

export const RENDER_FS = `#version 300 es
precision mediump float;
in float vBright;
in vec3 vColor;
out vec4 fragColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 2.6) * vBright;
  fragColor = vec4(vColor * a, a);
}
`;
