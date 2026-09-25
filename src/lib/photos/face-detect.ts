"use client";

/**
 * Whether a photo has a face in it, checked in the browser at upload time.
 *
 * This exists to keep a member's face out of any public-facing screen by
 * default, once one exists - see the "공개 범위" decision this is built ahead
 * of. Nothing reads has_face for that yet; every screen still requires login
 * regardless of this value. What this module does today is only classify and
 * record, so the column is already filled in correctly once a public view is
 * built on top of it.
 *
 * The result is a suggestion, not a verdict. A browser could report anything,
 * so nothing downstream should treat true/false as a security boundary on its
 * own - whatever policy reads has_face is the actual boundary, and it must
 * treat null (never checked, or checking failed) the same as true. Detection
 * finding nothing is the one way to end up with false, and that only happens
 * on a clean, positive result - never on an error, a timeout, or a browser
 * that cannot run WASM.
 *
 * @mediapipe/tasks-vision is loaded with a dynamic import, not a top-level
 * one, and only on the first call to detectFace. Its WASM runtime is a real
 * cost - about 3.1MB of Brotli-compressed transfer plus a 224KB model,
 * measured against the CDN this module loads from - and the club's members
 * mostly join from a phone. Nothing on this site should spend that unless a
 * member has actually opened the upload screen; loading it at the top of a
 * module that anything else imports would spend it on every visit instead.
 */

import type { FaceDetector as MpFaceDetector } from "@mediapipe/tasks-vision";

// Pinned rather than @latest: the WASM size above was measured against this
// exact version, and an unpinned CDN reference could grow or change behaviour
// under this page without anyone here deciding it should.
const SDK_VERSION = "1.0.1";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${SDK_VERSION}/wasm`;
// Google's own hosting for the model itself - not this project's CDN choice,
// and the one place a "latest" is intentional: it is Google's alias for the
// current release of this exact model, not an unrelated package that could
// change shape under us.
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";

let detectorPromise: Promise<MpFaceDetector> | null = null;

/**
 * The shared detector instance, created once per page load and reused by
 * every photo after the first. A fresh instance per photo would mean paying
 * the ~3.3MB download again for every file in a batch - a member uploading a
 * whole hike's worth of photos hands this a dozen files at once.
 */
function loadDetector(): Promise<MpFaceDetector> {
  detectorPromise ??= (async () => {
    const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    return FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: "IMAGE",
      // BlazeFace's short-range model is tuned for close-up faces (selfie
      // range), not the small, distant, often-turned faces a hike photo
      // actually has - a helmet-and-harness shot of someone forty metres up
      // a route is exactly this app's normal case, not an edge case. A low
      // threshold is the fail-closed choice for a filter whose job is "when
      // in doubt, treat it as a face": a missed face is what this exists to
      // prevent, and a photo wrongly held back costs nothing but a member
      // flipping one toggle once a public view exists to flip it in.
      minDetectionConfidence: 0.3,
    });
  })().catch((err) => {
    // A failed load must not wedge every later call behind the same
    // rejection - the next photo, or the next upload session, gets to try
    // again instead of inheriting this one's failure forever.
    detectorPromise = null;
    throw err;
  });
  return detectorPromise;
}

/**
 * true: a face was found. false: none was, with reasonable confidence.
 * null: could not tell - the model failed to load, the image could not be
 * decoded, or detection itself threw. Callers must treat null as true.
 */
export async function detectFace(file: File): Promise<boolean | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Not a photo format createImageBitmap can decode (or the browser lacks
    // it - Safari has supported this for years, but nothing here assumes so).
    // Unreadable is unknown, not "no face".
    return null;
  }

  try {
    const detector = await loadDetector();
    const result = detector.detect(bitmap);
    return result.detections.length > 0;
  } catch (err) {
    console.error("[face-detect] detection failed:", err);
    return null;
  } finally {
    bitmap.close();
  }
}
