import type { CropResult } from "../types";
import { clamp } from "../math";
import { IDX } from "../landmarks";

/**
 * High-Fidelity Monocular Neural Depth Estimator:
 * Emulates the depth distribution of modern monocular depth networks (Depth Anything / ZipDepth):
 * - Predicts continuous per-pixel relative depth from shading gradients, edge boundaries, and anatomical landmarks
 * - Recesses eye sockets and neck naturally
 * - Accurately projects nose bridge, lips, chin, and hair volume
 * - Preserves micro-relief textures (eyelid folds, cheekbones, hair volume) without artificial dome ballooning
 */
export function computeNeuralDepth(crop: CropResult): Float32Array {
  const { width: w, height: h, imageData, landmarks, mask, iod } = crop;
  const depth = new Float32Array(w * h);
  const data = imageData.data;

  // 1. Multi-scale Luminance & Gradient Map (Shape-from-Shading cues)
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    lum[i] = (data[p]! * 0.299 + data[p + 1]! * 0.587 + data[p + 2]! * 0.114) / 255;
  }

  // Compute 2D spatial gradients (Sobel-like)
  const gradX = new Float32Array(w * h);
  const gradY = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = row + x;
      gradX[idx] = (lum[idx + 1]! - lum[idx - 1]!) * 0.5;
      gradY[idx] = (lum[idx + w]! - lum[idx - w]!) * 0.5;
    }
  }

  // 2. Anatomical Anchor Field if landmarks exist
  const anchorField = new Float32Array(w * h);
  const anchorWeight = new Float32Array(w * h);
  let hasAnchors = false;

  if (landmarks && landmarks.length > 10) {
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of landmarks) {
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const zRange = Math.max(1e-4, maxZ - minZ);

    const radius = Math.max(8, iod * 0.28);
    const r2 = radius * radius;

    for (let lIdx = 0; lIdx < landmarks.length; lIdx++) {
      const p = landmarks[lIdx]!;
      // Invert MediaPipe camera Z: negative Z is closer to camera
      const normZ = clamp(1.0 - (p.z - minZ) / zRange, 0.0, 1.0);

      // Dramatic, anatomically authentic facial feature boosts for HD Neural Depth:
      // Nose tip & bridge: prominent forward projection (+Z)
      let boost = 0;
      if (lIdx === IDX.noseTip || lIdx === 4 || lIdx === 1) {
        boost = 0.42;
      } else if (lIdx === 195 || lIdx === 5 || lIdx === 6) {
        // Nasal dorsum / bridge
        boost = 0.32;
      } else if (lIdx === 13 || lIdx === 14 || lIdx === 0 || lIdx === 17) {
        // Lips / Philtrum
        boost = 0.18;
      } else if (lIdx === IDX.chin || lIdx === 152 || lIdx === 175) {
        // Chin projection
        boost = 0.22;
      } else if (lIdx === 116 || lIdx === 345 || lIdx === 123 || lIdx === 352) {
        // Zygomatic cheekbones
        boost = 0.16;
      } else if (lIdx === 33 || lIdx === 263 || lIdx === 159 || lIdx === 386 || lIdx === 133 || lIdx === 362) {
        // Orbital eye sockets: deep anatomical cavity
        boost = -0.28;
      } else if (lIdx === 10 || lIdx === 151 || lIdx === 9 || lIdx === 8) {
        // Forehead / Brow ridge
        boost = 0.14;
      } else if (lIdx === 234 || lIdx === 454 || lIdx === 127 || lIdx === 356) {
        // Pre-auricular / temples (sides of head): deep recession towards ears
        boost = -0.32;
      }

      const val = clamp(normZ * 0.95 + 0.10 + boost, 0.0, 1.2);
      const x0 = p.x | 0;
      const y0 = p.y | 0;
      const rad = radius | 0;

      for (let y = y0 - rad; y <= y0 + rad; y++) {
        if (y < 0 || y >= h) continue;
        const dy = y - p.y;
        for (let x = x0 - rad; x <= x0 + rad; x++) {
          if (x < 0 || x >= w) continue;
          const dx = x - p.x;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;

          // Gaussian radial basis function
          const g = Math.exp(-d2 / (r2 * 0.38));
          const idx = y * w + x;
          anchorField[idx] += val * g;
          anchorWeight[idx] += g;
        }
      }
    }

    for (let i = 0; i < w * h; i++) {
      if (anchorWeight[i]! > 1e-4) {
        anchorField[i] /= anchorWeight[i]!;
      }
    }
    hasAnchors = true;
  }

  // 3. Global Perspective & Anatomical Depth Synthesis
  const cx = w * 0.5;
  const cy = h * 0.48;
  const rx = w * 0.42;
  const ry = h * 0.52;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    const dy = (y - cy) / ry;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      const dx = (x - cx) / rx;
      const distSq = dx * dx + dy * dy;
      const m = mask[idx] ?? 0;

      // Base physiological profile:
      // Forehead & cheeks have natural rounded convexity, neck slopes backward
      let baseProfile = Math.max(0, 1.0 - Math.min(1.0, distSq));
      // Neck falloff (lower part of crop)
      if (y > cy + ry * 0.4) {
        const neckFactor = clamp((y - (cy + ry * 0.4)) / (h * 0.35), 0, 1);
        baseProfile *= 1.0 - neckFactor * 0.65;
      }

      // Shading micro-detail from gradients and luminance (Shape-from-Shading cues)
      const shadingVariation = (lum[idx]! - 0.5) * 0.18 - (gradY[idx]! * 0.12) + (Math.abs(gradX[idx]!) * 0.08);

      let dVal = baseProfile * 0.65;

      if (hasAnchors) {
        const wAnchor = clamp(anchorWeight[idx]! * 1.8, 0, 1);
        dVal = (dVal * (1 - wAnchor) + anchorField[idx]! * wAnchor) + shadingVariation * 0.5;
      } else {
        dVal = baseProfile * 0.68 + shadingVariation;
      }

      // Weight by foreground segmentation mask
      dVal = clamp(dVal, 0.0, 1.2) * (0.35 + 0.65 * m);
      depth[idx] = dVal;
    }
  }

  // 4. Edge-Preserving Bilateral Smoothing
  return smoothNeuralDepth(depth, lum, w, h, Math.max(2, iod * 0.04));
}

/**
 * Cross-bilateral depth smoother:
 * Uses image luminance as edge guide so depth discontinuities align precisely with visual edges.
 */
function smoothNeuralDepth(
  depth: Float32Array,
  guideLum: Float32Array,
  w: number,
  h: number,
  radius = 3,
): Float32Array {
  const out = new Float32Array(depth.length);
  const r = Math.max(1, Math.round(radius));
  const r2 = r * r;

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      const cLum = guideLum[idx]!;
      const cDepth = depth[idx]!;

      let sumVal = 0;
      let sumW = 0;

      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        const nRow = ny * w;

        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const distSq = dx * dx + dy * dy;
          if (distSq > r2) continue;

          const nIdx = nRow + nx;
          const lumDiff = guideLum[nIdx]! - cLum;
          // Weight by spatial distance and luminance difference
          const spatialW = 1.0 - Math.sqrt(distSq) / (r + 1);
          const rangeW = Math.exp(-(lumDiff * lumDiff) * 35);
          const totalW = spatialW * rangeW;

          sumVal += depth[nIdx]! * totalW;
          sumW += totalW;
        }
      }

      out[idx] = sumW > 1e-4 ? sumVal / sumW : cDepth;
    }
  }

  return out;
}
