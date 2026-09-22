import type { VisionResult } from "../types";
import type { SubjectType } from "./subject-field";

export interface ClassifierOptions {
  explicitType?: SubjectType;
  isText?: boolean;
}

/**
 * SubjectClassifier (v2 Remediation §5.1):
 * Inspects the input and vision signals to route processing to the optimal SubjectAdapter.
 * User manual override takes precedence.
 */
export function classifySubject(
  source: HTMLCanvasElement | string,
  vision?: VisionResult,
  options?: ClassifierOptions,
): SubjectType {
  // Explicit manual selection takes immediate priority
  if (options?.explicitType) {
    return options.explicitType;
  }

  // String input is always typography/text
  if (typeof source === "string" || options?.isText) {
    return "text";
  }

  // Human face confirmed by MediaPipe Vision
  if (vision && vision.hasFace) {
    return "face";
  }

  // If no face was detected by MediaPipe, analyze canvas heuristics
  // (e.g. Aspect ratio, edge density, color contrast)
  const w = source.width;
  const h = source.height;
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "object";

  // Check if image looks like text/logo (monochrome high-contrast with dark or white background)
  try {
    const data = ctx.getImageData(0, 0, Math.min(w, 128), Math.min(h, 128)).data;
    let satSum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      satSum += max === 0 ? 0 : (max - min) / max;
      count++;
    }
    const avgSat = satSum / Math.max(1, count);

    // Moderate to high saturation with organic shape is likely an animal or pet
    if (avgSat > 0.22) {
      return "animal";
    }
  } catch {
    // Canvas read restriction fallback
  }

  return "object";
}
