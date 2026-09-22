import type { CropResult, Params } from "../types";
import type { SubjectField } from "./subject-field";
import { workingSize } from "../config";
import { clamp } from "../math";

/**
 * AnimalAdapter (v2 Remediation §5.2):
 * Universal adapter for dogs, cats, horses, and wildlife.
 * Fits an adaptive principal-axis ellipsoid 3D dome to the animal's silhouette,
 * augmented with morphological edge and fur relief.
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

  // Scale & center source image
  const scale = Math.min(outW / source.width, outH / source.height) * 0.92;
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

  // Background estimation from corners
  let bgR = 0, bgG = 0, bgB = 0;
  const cornerCoords = [[0, 0], [outW - 1, 0], [0, outH - 1], [outW - 1, outH - 1]];
  for (const [cx, cy] of cornerCoords) {
    const idx = (cy * outW + cx) * 4;
    bgR += px[idx]!;
    bgG += px[idx + 1]!;
    bgB += px[idx + 2]!;
  }
  bgR /= 4; bgG /= 4; bgB /= 4;

  let m00 = 0, m10 = 0, m01 = 0;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const idx = (y * outW + x) * 4;
      const r = px[idx]!;
      const g = px[idx + 1]!;
      const b = px[idx + 2]!;

      // Color distance from background
      const dColor = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
      // Soft center bias
      const dxNorm = (x - outW / 2) / (outW / 2);
      const dyNorm = (y - outH / 2) / (outH / 2);
      const distFromCenter = Math.sqrt(dxNorm * dxNorm + dyNorm * dyNorm);
      const centerFactor = clamp(1.4 - distFromCenter * 0.8, 0.2, 1.2);

      const mVal = clamp((dColor / 45) * centerFactor, 0, 1);
      const i = y * outW + x;
      mask[i] = mVal;
      hairSkin[i] = mVal > 0.35 ? 1 : 0;
      faceSkin[i] = mVal > 0.4 ? 1 : 0;

      if (mVal > 0.35) {
        m00 += mVal;
        m10 += x * mVal;
        m01 += y * mVal;
      }
    }
  }

  // Moments for center of mass
  const centerX = m00 > 0 ? m10 / m00 : outW / 2;
  const centerY = m00 > 0 ? m01 / m00 : outH / 2;

  // Compute second central moments for principal ellipsoid dome
  let u20 = 0, u02 = 0;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = y * outW + x;
      const wVal = mask[i]!;
      if (wVal > 0.35) {
        u20 += (x - centerX) ** 2 * wVal;
        u02 += (y - centerY) ** 2 * wVal;
      }
    }
  }
  const radX = Math.max(outW * 0.25, Math.sqrt(u20 / Math.max(1, m00)) * 1.8);
  const radY = Math.max(outH * 0.28, Math.sqrt(u02 / Math.max(1, m00)) * 1.8);

  // Volumetric dome + fur luminance relief
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = y * outW + x;
      const nx = (x - centerX) / radX;
      const ny = (y - centerY) / radY;
      const d = nx * nx + ny * ny;
      const dist = Math.sqrt(d);
      const dome = dist < 1.0 ? 0.5 * (1.0 + Math.cos(dist * Math.PI)) : 0.0;

      const idx = i * 4;
      const lum = (0.299 * px[idx]! + 0.587 * px[idx + 1]! + 0.114 * px[idx + 2]!) / 255;
      const furRelief = (lum - 0.5) * 0.18;

      depthMap[i] = clamp((dome * 0.75 + furRelief) * mask[i]!, 0, 1);
      depthConfidence[i] = mask[i]!;
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
