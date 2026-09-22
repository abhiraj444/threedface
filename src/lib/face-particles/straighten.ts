import type { VisionResult } from "./types";
import { IDX } from "./landmarks";
import { analyze } from "./vision";

export interface StraightenResult {
  source: HTMLCanvasElement;
  vision: VisionResult;
  rollDeg: number;
  didStraighten: boolean;
}

/**
 * 4-Pass Face Straighten Algorithm (v2 Remediation §2.2):
 *
 * Pass A (measure): Compute roll angle from eye-landmark line (atan2(Δy, Δx)).
 * Pass B (re-crop/rotate): Rotate source image around face center into a larger
 *   scratch canvas sized with trigonometric bounding to eliminate corner clipping.
 * Pass C (re-detect): Re-run landmark detection and segmentation on the rotated
 *   canvas so all landmark coordinates and segmentation masks are freshly calibrated
 *   post-rotation, completely eliminating skew.
 * Pass D (hand-off): Return the fresh aligned canvas and vision result for final cropping.
 */
export async function straightenFace(
  source: HTMLCanvasElement,
  vision: VisionResult,
  enabled: boolean,
): Promise<StraightenResult> {
  const lm = vision.landmarks;
  if (!enabled || !lm || lm.length <= IDX.leftEyeOuter) {
    return { source, vision, rollDeg: 0, didStraighten: false };
  }

  const rEye = lm[IDX.rightEyeOuter];
  const lEye = lm[IDX.leftEyeOuter];
  if (!rEye || !lEye) {
    return { source, vision, rollDeg: 0, didStraighten: false };
  }

  const srcW = source.width;
  const srcH = source.height;

  // Pass A: Measure roll angle from inter-ocular vector
  const dx = (lEye.x - rEye.x) * srcW;
  const dy = (lEye.y - rEye.y) * srcH;
  const angleRad = Math.atan2(dy, dx);
  const rollDeg = (angleRad * 180) / Math.PI;

  // If already nearly level (< 0.8 degrees), skip re-rotation to save compute
  if (Math.abs(angleRad) < 0.014) {
    return { source, vision, rollDeg, didStraighten: false };
  }

  // Face center of rotation
  const nose = lm[IDX.noseTip];
  const eyeMidX = ((rEye.x + lEye.x) / 2) * srcW;
  const eyeMidY = ((rEye.y + lEye.y) / 2) * srcH;
  const rotCx = eyeMidX;
  const rotCy = nose ? (nose.y * srcH + eyeMidY) * 0.5 : eyeMidY;

  // Pass B: Expand scratch canvas dimensions to guarantee zero corner clipping
  const cos = Math.abs(Math.cos(angleRad));
  const sin = Math.abs(Math.sin(angleRad));
  const newW = Math.ceil(srcW * cos + srcH * sin);
  const newH = Math.ceil(srcW * sin + srcH * cos);

  const scratch = document.createElement("canvas");
  scratch.width = newW;
  scratch.height = newH;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return { source, vision, rollDeg: 0, didStraighten: false };
  }

  // Draw rotated source centered
  ctx.save();
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(-angleRad);
  ctx.translate(-rotCx, -rotCy);
  ctx.drawImage(source, 0, 0);
  ctx.restore();

  // Pass C: Re-run MediaPipe landmark detection and segmentation on freshly aligned image
  try {
    const freshVision = await analyze(scratch);
    if (freshVision.hasFace && freshVision.landmarks) {
      return {
        source: scratch,
        vision: freshVision,
        rollDeg,
        didStraighten: true,
      };
    }
  } catch (err) {
    console.warn("Straighten re-detection fell back to original orientation:", err);
  }

  // Fallback if re-detection failed
  return { source, vision, rollDeg: 0, didStraighten: false };
}
