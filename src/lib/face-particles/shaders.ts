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

// Fast harmonic 3D organic turbulence (approx. divergence-free, zero texture/hash stall)
vec3 fastTurbulence(vec3 p, float t) {
  vec3 p1 = p * 1.8 + vec3(t * 0.15, t * 0.12, t * 0.08);
  return vec3(
    sin(p1.y * 2.3 + p1.z * 1.7) * cos(p1.x * 1.4),
    cos(p1.z * 2.1 + p1.x * 1.9) * sin(p1.y * 1.5),
    sin(p1.x * 2.0 + p1.y * 2.4) * cos(p1.z * 1.6)
  ) * 0.42;
}

void main() {
  vec3 f = vec3(0.0);

  // Mode 5: Celestial Fill / Stream (Cascade down and settle layer-by-layer)
  if (uMode > 4.5) {
    float stagger = aSeed * 0.28;
    float reach = smoothstep(uEffectT - 0.16 + stagger, uEffectT + 0.10 + stagger, aHome.y);
    vec3 springForce = (aHome - aPos) * (uSpring * 1.85);
    float sway = sin(uTime * 4.5 + aSeed * 32.0) * 0.25;
    float streamZ = (aHome.z - aPos.z) * 4.5;
    vec3 streamForce = vec3(
      (aHome.x - aPos.x) * 4.5 + sway,
      -2.4 - aSeed * 1.2,
      streamZ
    );
    f += mix(streamForce, springForce, reach);
  } else {
    // Standard harmonic spring with per-particle emergence
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

  // Base ambient 3D organic turbulence (fast, smooth, zero micro-stutter)
  if (uTurb > 0.005) {
    f += fastTurbulence(aPos, uTime) * uTurb;
  }

  // Mode 1: Vortex / Spiral Streams
  if (uMode > 0.5 && uMode < 1.5) {
    vec2 delta = aPos.xy - uEffectOrigin;
    float r = length(delta);
    if (r > 0.001) {
      vec2 tangent = vec2(-delta.y, delta.x) / r;
      vec2 radial = -delta / r;
      float falloff = 1.0 / (1.0 + r * 2.5);
      float particlePhase = sin(r * 12.0 - uTime * 6.0 + aSeed * 6.28) * 0.35;
      f.xy += (tangent * 4.2 + radial * (1.2 + particlePhase)) * uEffectAmp * falloff;
      f.z += sin(r * 8.0 + aSeed * 10.0) * uEffectAmp * 0.5 * falloff;
    }
  }
  // Mode 2: Traveling Harmonic Wave
  else if (uMode > 1.5 && uMode < 2.5) {
    float waveFront = uEffectOrigin.x;
    float distToFront = aPos.x - waveFront;
    float envelope = exp(-pow(distToFront * 3.2, 2.0));
    float phase = distToFront * 14.0 - uTime * 8.0 + aSeed * 4.0;
    f.z += sin(phase) * (uEffectAmp * 2.6) * envelope;
    f.y += cos(phase * 0.7) * (uEffectAmp * 1.2) * envelope;
    f.x += sin(phase * 0.5) * (uEffectAmp * 0.8) * envelope;
  }
  // Mode 3: Resonance Ripple
  else if (uMode > 2.5 && uMode < 3.5) {
    vec3 d = aPos - vec3(uEffectOrigin, 0.0);
    float dist = length(d);
    float waveRadius = uEffectT * 1.85;
    float ring = exp(-pow((dist - waveRadius) * 8.0, 2.0));
    vec3 dir = dist > 1e-4 ? d / dist : vec3(0.0, 0.0, 1.0);
    float crest = sin((dist - waveRadius) * 22.0 + aSeed * 2.0);
    f += dir * (ring * crest * uEffectAmp * 3.8);
    f.z += ring * (uEffectAmp * 2.2) * (1.0 + aSeed);
  }
  // Mode 4: Disassemble / Break
  else if (uMode > 3.5 && uMode < 4.5) {
    vec3 d = aPos - vec3(uEffectOrigin, 0.0);
    float dist = length(d);
    vec3 dir = dist > 1e-4 ? normalize(d) : vec3(0.0, 0.0, 1.0);
    vec3 chaoticSpur = fastTurbulence(aPos * 2.5, uTime * 3.0 + aSeed * 20.0);
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
layout(location = 4) in float aSemantic;
uniform mat4 uViewProj;
uniform float uSize;
uniform float uDpr;
uniform vec2 uPointRange;
uniform float uTime;
uniform float uBreath;
uniform float uColorMode;
uniform float uColorMix;
uniform float uInvert;
uniform float uDistScale;
uniform float uRadiance;
out float vBright;
out vec3 vColor;

void main() {
  vec3 p = aPos;
  p.z += sin(uTime * 1.35 + aSeed * 6.28318) * uBreath;
  gl_Position = uViewProj * vec4(p, 1.0);
  
  float depthScale = 0.75 + 0.25 * (1.0 - clamp(p.z * 0.85 + 0.35, 0.0, 1.0));
  float distScale = clamp(uDistScale, 0.52, 1.55);
  float size = uSize * uDpr * depthScale * distScale;
  gl_PointSize = clamp(size, uPointRange.x, uPointRange.y);
  
  float tone = aTone;
  float densityComp = clamp(pow(distScale, 0.42), 0.72, 1.28);
  float rad = clamp(uRadiance, 0.4, 2.2);
  float sem = aSemantic;

  // Compute color luminance and vibrance saturation boost
  float rawLum = dot(aColor, vec3(0.299, 0.587, 0.114));
  float satBoost = 1.0 + (rad - 1.0) * 0.55;
  vec3 vibrantColor = clamp(mix(vec3(rawLum), aColor, satBoost), 0.0, 1.0);

  // Anatomical brightness & contrast grading
  if (uInvert < 0.5) {
    // -------------------------------------------------------------
    // DARK BACKGROUND MODE (Black canvas, luminous particles)
    // -------------------------------------------------------------
    float b = 1.0;

    // Skin (sem == 2.0): radiant warm highlight lift with soft rolloff
    if (sem > 1.5 && sem < 2.5) {
      float skinLift = pow(tone, max(0.35, 1.0 - (rad - 1.0) * 0.55)) * (0.8 + 0.35 * rad);
      b = (0.54 + 0.46 * skinLift) * (0.82 + 0.18 * depthScale);
      vibrantColor = clamp(vibrantColor * (0.94 + 0.12 * (rad - 1.0)), 0.0, 1.0);
    }
    // Hair (sem == 1.0): if dark, deepen blackness & contrast; if light/blonde, boost luster
    else if (sem > 0.5 && sem < 1.5) {
      if (rawLum < 0.36) {
        // Deepen dark hair into velvet blackness as radiance increases
        float hairDarkness = pow(tone, 1.0 + (rad - 1.0) * 0.75) * max(0.4, 1.0 - (rad - 1.0) * 0.32);
        b = (0.36 + 0.54 * hairDarkness) * (0.82 + 0.18 * depthScale);
      } else {
        // Boost bright blonde/silver hair luster
        float hairLuster = pow(tone, max(0.35, 1.0 - (rad - 1.0) * 0.5)) * (0.8 + 0.35 * rad);
        b = (0.55 + 0.45 * hairLuster) * (0.82 + 0.18 * depthScale);
      }
    }
    // Features: Eyes, Brows, Lips (sem == 3.0): heighten contrast and eye specular pop
    else if (sem > 2.5) {
      float featPop = pow(tone, 0.8) * (0.85 + 0.35 * rad);
      b = (0.62 + 0.48 * featPop) * (0.82 + 0.18 * depthScale);
      vibrantColor = clamp(mix(vec3(rawLum), aColor, 1.0 + (rad - 1.0) * 0.75), 0.0, 1.0);
    }
    // Torso / Background elements (sem == 0.0)
    else {
      b = (0.58 + 0.42 * tone) * rad * (0.82 + 0.18 * depthScale);
    }

    vBright = clamp(b * densityComp, 0.1, 1.8);
  } else {
    // -------------------------------------------------------------
    // WHITE BACKGROUND MODE (White canvas, dark ink particles)
    // Inversely proportional: more radiance = sculpted rich ink density,
    // deeper hair and feature silhouettes so facial form doesn't wash out!
    // -------------------------------------------------------------
    float b = 1.0;

    // Skin on white: preserve sculpted delicate ink density so pale skin doesn't vanish
    if (sem > 1.5 && sem < 2.5) {
      float skinInk = pow(tone, max(0.4, 1.0 - (rad - 1.0) * 0.4)) * (0.85 + 0.25 * rad);
      b = (0.74 + 0.26 * skinInk) * (0.86 + 0.14 * depthScale);
    }
    // Hair on white: maximize crisp jet-black ink density for dark hair
    else if (sem > 0.5 && sem < 1.5) {
      if (rawLum < 0.36) {
        b = (0.88 + 0.28 * (rad - 1.0)) * (0.86 + 0.14 * depthScale);
      } else {
        b = (0.65 + 0.35 * tone) * (0.86 + 0.14 * depthScale);
      }
    }
    // Features on white: sharp ink definition for pupils, iris, and lips
    else if (sem > 2.5) {
      b = (0.86 + 0.25 * (rad - 1.0)) * (0.86 + 0.14 * depthScale);
    }
    // Torso / Other on white
    else {
      b = (0.76 + 0.24 * tone) * (0.86 + 0.14 * depthScale);
    }

    vBright = clamp(b, 0.2, 1.9);
  }

  // Color Modes: 0.0 = Monochrome, 1.0 = Full Color, 2.0 = Hybrid
  vec3 col;
  float isCol = step(aSeed, clamp(uColorMix, 0.05, 0.95));

  if (uInvert < 0.5) {
    if (uColorMode < 0.5) {
      col = vec3(1.0);
    } else if (uColorMode < 1.5) {
      col = vibrantColor;
    } else {
      col = mix(vec3(1.0), vibrantColor, isCol);
    }
  } else {
    // Rich artist inks on white paper
    vec3 inkBlack = vec3(0.03, 0.03, 0.04);
    // On white paper, colors are rendered as rich pigmented watercolor inks
    vec3 richColor = clamp(pow(vibrantColor, vec3(0.92)) * (0.88 + 0.18 * (rad - 1.0)), 0.0, 1.0);
    if (uColorMode < 0.5) {
      col = inkBlack;
    } else if (uColorMode < 1.5) {
      col = richColor;
    } else {
      col = mix(inkBlack, richColor, isCol);
    }
  }

  vColor = col;
}
`;

export const RENDER_FS = `#version 300 es
precision highp float;
in float vBright;
in vec3 vColor;
out vec4 fragColor;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;

  // High-performance smooth Gaussian stipple falloff
  // Extremely fast across mobile GPUs, zero branching, crystal-clear facial resemblance
  float a = exp(-r2 * 2.8) * vBright;
  fragColor = vec4(vColor * a, a);
}
`;
