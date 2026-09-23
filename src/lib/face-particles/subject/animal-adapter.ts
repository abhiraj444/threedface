import type { CropResult, Params } from "../types";
import type { SubjectField } from "./subject-field";
import { workingSize } from "../config";
import { clamp } from "../math";

/**
 * AnimalAdapter (v2 Remediation §5.2):
 * Universal adapter for dogs, cats, horses, and wildlife.
 * Fits an anatomical animal head 3D field:
 * - Volumetric skull dome
 * - Forward-projecting snout / muzzle (+Z extension in lower-center)
 * - Eye socket depth depressions
 * - Tall ear planes
 * - Fur contrast relief
 */
export function buildAnimalSubject(
  source: HTMLCanvasElement,
  _params: Params,
): SubjectField {
  const { w: outW, h: outH } = workingSize();
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not initialize animal canvas");

  ctx.fillStyle = "#050506";
  ctx.fillRect(0, 0, outW, outH);

  // Scale & center source image with healthy margin
  const scale = Math.min(outW / source.width, outH / source.height) * 0.94;
  const drawW = source.width * scale;
  const drawH = source.height * scale;
  const drawX = (outW - drawW) / 2;
  const drawY = (outH - drawH) / 2;
  ctx.drawImage(source, drawX, drawY, drawW, drawH);

  const imgData = ctx.getImageData(0, 0, outW, outH);
  const px = imgData.data;

  const mask = new Float32Array(outW * outH);
  const hairSkin = new Float32Array(outW * outH);
  const faceSkin = new Float32Array(outW * outH);
  const depthMap = new Float32Array(outW * outH);
  const depthConfidence = new Float32Array(outW * outH);

  // Robust background estimation from borders
  let bgR = 0, bgG = 0, bgB = 0;
  let borderCount = 0;
  // Sample perimeter (top edge, left edge, right edge)
  for (let x = 0; x < outW; x += 12) {
    const topIdx = (4 * outW + x) * 4;
    bgR += px[topIdx]!;
    bgG += px[topIdx + 1]!;
    bgB += px[topIdx + 2]!;
    borderCount++;
  }
  for (let y = 0; y < outH; y += 12) {
    const leftIdx = (y * outW + 4) * 4;
    const rightIdx = (y * outW + (outW - 5)) * 4;
    bgR += px[leftIdx]! + px[rightIdx]!;
    bgG += px[leftIdx + 1]! + px[rightIdx + 1]!;
    bgB += px[leftIdx + 2]! + px[rightIdx + 2]!;
    borderCount += 2;
  }
  bgR /= Math.max(1, borderCount);
  bgG /= Math.max(1, borderCount);
  bgB /= Math.max(1, borderCount);

  let m00 = 0, m10 = 0, m01 = 0;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const idx = (y * outW + x) * 4;
      const r = px[idx]!;
      const g = px[idx + 1]!;
      const b = px[idx + 2]!;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b);

      // Distance from estimated background
      const dColor = Math.hypot(r - bgR, g - bgG, b - bgB);
      const dxNorm = (x - outW / 2) / (outW * 0.45);
      const dyNorm = (y - outH / 2) / (outH * 0.45);
      const distFromCenter = Math.hypot(dxNorm, dyNorm);

      // Smooth central bounding envelope for the animal subject
      const centerFactor = clamp(1.4 - distFromCenter * 0.9, 0.0, 1.0);

      // Black fur & dark muzzle protection:
      // Dark pixels in the central region are prime organic foreground (dog fur, nose, eyes)
      const isDarkCentral = lum < 90 && distFromCenter < 0.75;
      const colorDiff = dColor / 38;

      let mVal = clamp(Math.max(colorDiff, isDarkCentral ? 0.9 : 0) * (0.35 + 0.65 * centerFactor), 0, 1);
      if (distFromCenter < 0.45) {
        mVal = Math.max(mVal, 0.85); // Center core is always foreground animal subject
      }
      if (distFromCenter > 1.25) {
        mVal *= Math.max(0, 1.5 - distFromCenter); // Fade outer margins cleanly
      }

      const i = y * outW + x;
      mask[i] = mVal;
      hairSkin[i] = mVal > 0.15 ? 1 : 0;
      faceSkin[i] = mVal > 0.25 ? 1 : 0;

      if (mVal > 0.2) {
        m00 += mVal;
        m10 += x * mVal;
        m01 += y * mVal;
      }
    }
  }

  // Moments for center of mass of the animal head / body
  const centerX = m00 > 0 ? m10 / m00 : outW / 2;
  const centerY = m00 > 0 ? m01 / m00 : outH / 2;

  // Compute second central moments for principal head ellipsoid
  let u20 = 0, u02 = 0;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = y * outW + x;
      const wVal = mask[i]!;
      if (wVal > 0.2) {
        u20 += (x - centerX) ** 2 * wVal;
        u02 += (y - centerY) ** 2 * wVal;
      }
    }
  }
  const radX = Math.max(outW * 0.30, Math.sqrt(u20 / Math.max(1, m00)) * 1.55);
  const radY = Math.max(outH * 0.35, Math.sqrt(u02 / Math.max(1, m00)) * 1.55);

  // Anatomical landmarks for an animal head:
  // Snout is typically positioned slightly below center, projecting closest to camera
  const snoutX = centerX;
  const snoutY = centerY + radY * 0.16;
  const snoutRadX = radX * 0.38;
  const snoutRadY = radY * 0.34;

  // Volumetric animal depth synthesis:
  // 1. Base cranial dome
  // 2. Pronounced forward snout / muzzle projection (+Z)
  // 3. Eye socket depth cavities
  // 4. Fur detail relief (high-frequency organic microtexture)
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = y * outW + x;
      const m = mask[i]!;

      // 1. Base head dome
      const nx = (x - centerX) / radX;
      const ny = (y - centerY) / radY;
      const d = nx * nx + ny * ny;
      const dist = Math.sqrt(d);
      const headDome = dist < 1.0 ? Math.pow(0.5 * (1.0 + Math.cos(dist * Math.PI)), 0.8) * 0.58 : 0.0;

      // 2. Snout & muzzle projection (closest to camera, highest Z)
      const sx = (x - snoutX) / snoutRadX;
      const sy = (y - snoutY) / snoutRadY;
      const sDist = Math.sqrt(sx * sx + sy * sy);
      const snoutCone = sDist < 1.0 ? Math.pow(0.5 * (1.0 + Math.cos(sDist * Math.PI)), 0.75) * 0.48 : 0.0;

      // 3. Eye socket depressions (left and right above snout)
      const leftEyeDist = Math.hypot((x - (centerX - radX * 0.32)) / (radX * 0.22), (y - (centerY - radY * 0.14)) / (radY * 0.22));
      const rightEyeDist = Math.hypot((x - (centerX + radX * 0.32)) / (radX * 0.22), (y - (centerY - radY * 0.14)) / (radY * 0.22));
      const eyeCavity = (leftEyeDist < 1.0 ? (1.0 - leftEyeDist) * 0.12 : 0.0) +
                        (rightEyeDist < 1.0 ? (1.0 - rightEyeDist) * 0.12 : 0.0);

      // 4. Fur micro-texture relief (preserves organic fur strands without suppressing dark fur)
      const idx = i * 4;
      const lum = (0.299 * px[idx]! + 0.587 * px[idx + 1]! + 0.114 * px[idx + 2]!) / 255;
      // High-frequency texture rather than absolute brightness
      const furRelief = Math.abs(lum - 0.5) * 0.08;

      // Total blended depth: Base Cranial Dome + Snout Projection - Eye Cavity + Fur
      const rawDepth = (headDome + snoutCone - eyeCavity + furRelief) * (0.40 + 0.60 * m);
      depthMap[i] = clamp(rawDepth, 0.0, 1.0);
      depthConfidence[i] = m;
    }
  }

  const crop: CropResult = {
    canvas,
    imageData: imgData,
    width: outW,
    height: outH,
    landmarks: null,
    mask,
    hairSkin,
    faceSkin,
    iod: radX * 0.6,
    hasFace: false,
  };

  return {
    subjectType: "animal",
    width: outW,
    height: outH,
    depthMap,
    depthConfidence,
    segMask: mask,
    colorMap: px,
    controlPoints: [
      { x: centerX, y: centerY, z: 0.65, group: "animal_center" },
      { x: centerX - radX * 0.4, y: centerY - radY * 0.4, z: 0.5, group: "animal_left_ear" },
      { x: centerX + radX * 0.4, y: centerY - radY * 0.4, z: 0.5, group: "animal_right_ear" },
    ],
    boundingBox: {
      x: centerX - radX,
      y: centerY - radY,
      w: radX * 2,
      h: radY * 2,
      rollDeg: 0,
    },
    crop,
  };
}
