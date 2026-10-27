MediaPipe Tasks Vision — offline vendor bundle (v0.3)
=====================================================

Version:  @mediapipe/tasks-vision 0.10.18
License:  Apache-2.0 (https://www.apache.org/licenses/LICENSE-2.0)
Purpose:  Local-only face *presence* detection (is a face visible?).
          Does not identify people. Camera frames never leave the iPad.

Why this folder exists
----------------------
The Raspberry Pi hotspot has no internet. Safari cannot load jsDelivr or
Google Storage. These files are served by nginx from the same host as
index.html.

Files
-----
  vision_bundle.mjs
      JavaScript API (FaceDetector, FilesetResolver).

  wasm/vision_wasm_internal.js
  wasm/vision_wasm_internal.wasm
  wasm/vision_wasm_nosimd_internal.js
  wasm/vision_wasm_nosimd_internal.wasm
      WebAssembly runtime (SIMD and no-SIMD builds). Safari picks one.

  models/blaze_face_short_range.tflite
      BlazeFace short-range float16 model (same model v0.2 loaded from
      storage.googleapis.com).

Do not point camera.js at CDNs. Keep these files next to the app.

Re-download later (on a machine WITH internet), if you bump versions:
  1. Download https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.18.tgz
  2. Extract vision_bundle.mjs and the wasm/ folder into this directory.
  3. Download blaze_face_short_range.tflite (float16 / short range) into models/.
  4. Keep JS, WASM, and model versions matched.
