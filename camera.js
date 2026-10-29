/**
 * camera.js — Privacy-preserving local camera + face presence detection (v0.4)
 * ---------------------------------------------------------------------------
 * PURPOSE OF FACE DETECTION:
 *   Answer ONLY: "Is a face visible right now?"
 *   Does NOT identify people or infer age, gender, race, emotion, etc.
 *
 * PRIVACY ARCHITECTURE:
 *   - getUserMedia() creates a temporary in-memory MediaStream in this browser tab.
 *   - Frames are shown in a <video> element and passed to MediaPipe Face Detector
 *     running locally via WebAssembly in this browser process.
 *   - Camera frames are NEVER uploaded, saved, recorded, or sent to a server/AI API.
 *   - MediaPipe JS, WASM, and the face model are served from ./vendor/mediapipe/
 *     on this same host (Raspberry Pi / local nginx). No CDN. No internet required.
 *   - stopCamera() stops every MediaStreamTrack, clears video.srcObject, and ends detection.
 *
 * CAMERA STATES (separate from monster classification):
 *   CAMERA_OFF | CAMERA_REQUESTING_PERMISSION | CAMERA_ACTIVE |
 *   SUBJECT_NOT_DETECTED | SUBJECT_DETECTED | SCANNING | RESULT | ERROR
 */

(function (global) {
  "use strict";

/** Loaded on demand so the standby UI still works if the WASM bundle is blocked. */
let FaceDetector = null;
let FilesetResolver = null;

function vendorAssetUrl(relativePath) {
  return new URL(relativePath, global.location.href).href;
}

async function loadVisionLibrary() {
  if (FaceDetector && FilesetResolver) {
    return { FaceDetector, FilesetResolver };
  }
  const bundleUrl = vendorAssetUrl("./vendor/mediapipe/vision_bundle.mjs");
  const mod = await import(bundleUrl);
  FaceDetector = mod.FaceDetector;
  FilesetResolver = mod.FilesetResolver;
  return mod;
}

/**
 * True only when this browser can actually open a camera.
 * file://, missing APIs, and machines with no webcam count as unavailable.
 */
function probeCameraAvailability() {
  if (!global.isSecureContext) {
    return Promise.resolve({ available: false, reason: "INSECURE_CONTEXT" });
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return Promise.resolve({ available: false, reason: "UNSUPPORTED" });
  }
  if (!navigator.mediaDevices.enumerateDevices) {
    return Promise.resolve({ available: true, reason: "API_OK" });
  }
  return navigator.mediaDevices
    .enumerateDevices()
    .then((devices) => {
      const hasVideo = devices.some((d) => d.kind === "videoinput");
      return {
        available: hasVideo,
        reason: hasVideo ? "CAMERA_FOUND" : "NO_CAMERA",
      };
    })
    .catch(() => ({ available: false, reason: "ENUM_FAILED" }));
}

/** @enum {string} */
const CameraState = Object.freeze({
  CAMERA_OFF: "CAMERA_OFF",
  CAMERA_REQUESTING_PERMISSION: "CAMERA_REQUESTING_PERMISSION",
  CAMERA_ACTIVE: "CAMERA_ACTIVE",
  SUBJECT_NOT_DETECTED: "SUBJECT_NOT_DETECTED",
  SUBJECT_DETECTED: "SUBJECT_DETECTED",
  SCANNING: "SCANNING",
  RESULT: "RESULT",
  ERROR: "ERROR",
});

const MEDIAPIPE_WASM = vendorAssetUrl("./vendor/mediapipe/wasm/");
const FACE_MODEL = vendorAssetUrl(
  "./vendor/mediapipe/models/blaze_face_short_range.tflite"
);

/** Require this many consecutive positive frames before declaring SUBJECT_DETECTED */
const DETECT_STREAK_REQUIRED = 8;
/** Skip detection work if last video timestamp unchanged */
const DETECT_MIN_INTERVAL_MS = 80;

/**
 * @typedef {Object} CameraControllerOptions
 * @property {HTMLVideoElement} videoEl
 * @property {(state: string, detail?: object) => void} [onStateChange]
 * @property {(info: string, data?: unknown) => void} [onLog]
 */

function createCameraController(options) {
  const videoEl = options.videoEl;
  const onStateChange = options.onStateChange || (() => {});
  const onLog = options.onLog || ((msg, data) => {
    if (data !== undefined) console.info("[Camera]", msg, data);
    else console.info("[Camera]", msg);
  });

  /** @type {string} */
  let state = CameraState.CAMERA_OFF;
  /** @type {MediaStream|null} */
  let mediaStream = null;
  /** @type {FaceDetector|null} */
  let faceDetector = null;
  let detectorReady = false;
  let detectorLoading = null;
  /** Prevents track "ended" from treating intentional shutdown as an error */
  let shuttingDown = false;

  let detectionActive = false;
  let rafId = 0;
  let lastVideoTime = -1;
  let lastDetectMs = 0;
  let detectStreak = 0;
  /** @type {((detected: boolean) => void)|null} */
  let onPresence = null;

  /** @type {string|null} */
  let lastErrorCode = null;
  /** @type {string|null} */
  let lastErrorMessage = null;

  function setState(next, detail) {
    state = next;
    onLog("state → " + next, detail || null);
    onStateChange(next, detail || {});
  }

  function getState() {
    return state;
  }

  function getLastError() {
    return { code: lastErrorCode, message: lastErrorMessage };
  }

  function isCameraStreaming() {
    if (!mediaStream) return false;
    return mediaStream.getTracks().some((t) => t.readyState === "live");
  }

  /**
   * Privacy banner text must match reality.
   * @returns {{ primary: string, secondary: string }}
   */
  function getPrivacyCopy() {
    if (isCameraStreaming()) {
      return {
        primary: "CAMERA ACTIVE — LOCAL PROCESSING ONLY",
        secondary: "No images are stored or transmitted.",
      };
    }
    if (state === CameraState.RESULT || state === CameraState.CAMERA_OFF) {
      // After a session, be explicit that nothing was kept
      if (state === CameraState.RESULT) {
        return {
          primary: "CAMERA OFF",
          secondary: "No image retained.",
        };
      }
    }
    return {
      primary: "No images are stored or transmitted.",
      secondary: "Offline bundle — detection runs locally. Nothing is uploaded.",
    };
  }

  async function ensureFaceDetector() {
    if (faceDetector && detectorReady) return faceDetector;
    if (detectorLoading) return detectorLoading;

    detectorLoading = (async () => {
      onLog("Loading MediaPipe Face Detector from local vendor/ files (WASM + model).");
      onLog("No CDN. Inference and camera frames stay on this device.");
      const visionLib = await loadVisionLibrary();
      const vision = await visionLib.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);

      const optionsBase = {
        runningMode: "VIDEO",
        minDetectionConfidence: 0.55,
        minSuppressionThreshold: 0.3,
      };

      try {
        faceDetector = await visionLib.FaceDetector.createFromOptions(vision, {
          ...optionsBase,
          baseOptions: {
            modelAssetPath: FACE_MODEL,
            delegate: "GPU",
          },
        });
        onLog("Face detector ready (local WASM, GPU delegate).");
      } catch (gpuErr) {
        onLog("GPU delegate failed; retrying with CPU", gpuErr);
        faceDetector = await visionLib.FaceDetector.createFromOptions(vision, {
          ...optionsBase,
          baseOptions: {
            modelAssetPath: FACE_MODEL,
            delegate: "CPU",
          },
        });
        onLog("Face detector ready (local WASM, CPU delegate).");
      }

      detectorReady = true;
      return faceDetector;
    })();

    try {
      return await detectorLoading;
    } catch (err) {
      detectorLoading = null;
      detectorReady = false;
      faceDetector = null;
      throw err;
    }
  }

  /**
   * Request camera permission and start live preview.
   * Prefers front/user camera on mobile / iPad.
   */
  async function startCamera() {
    lastErrorCode = null;
    lastErrorMessage = null;

    if (!window.isSecureContext) {
      return fail(
        "INSECURE_CONTEXT",
        "Camera requires a secure context (localhost or HTTPS)."
      );
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return fail(
        "UNSUPPORTED",
        "This browser does not support camera access."
      );
    }

    // Stop any prior stream first (never leave orphan tracks)
    await stopCamera({ silent: true });

    setState(CameraState.CAMERA_REQUESTING_PERMISSION);

    // Warm detector in parallel with permission prompt when possible
    const detectorPromise = ensureFaceDetector().catch((err) => {
      onLog("Face detector failed to load", err);
      return null;
    });

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch (err) {
      const name = (err && err.name) || "Error";
      onLog("getUserMedia failed", err);
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        return fail("PERMISSION_DENIED", "Camera access was not granted.");
      }
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        return fail("NO_CAMERA", "No camera is available on this device.");
      }
      if (name === "NotReadableError" || name === "TrackStartError") {
        return fail("CAMERA_BUSY", "Camera could not be initialized.");
      }
      return fail("CAMERA_ERROR", "Camera could not be initialized.");
    }

    mediaStream = stream;
    videoEl.srcObject = stream;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.setAttribute("playsinline", "");
    videoEl.setAttribute("webkit-playsinline", "");

    // If the stream dies unexpectedly, tear down and surface an error
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        onLog("Video track ended event");
        if (shuttingDown) return;
        if (
          state === CameraState.CAMERA_OFF ||
          state === CameraState.RESULT ||
          state === CameraState.ERROR
        ) {
          return;
        }
        stopCamera({ silent: true, nextState: CameraState.ERROR }).then(() => {
          fail("STREAM_ENDED", "Camera stream unexpectedly stopped.");
        });
      });
    });

    try {
      await videoEl.play();
    } catch (err) {
      onLog("video.play() failed", err);
      await stopCamera({ silent: true });
      return fail("PLAY_FAILED", "Camera could not be initialized.");
    }

    const detector = await detectorPromise;
    if (!detector) {
      await stopCamera({ silent: true });
      return fail(
        "DETECTOR_FAILED",
        "Local face detector could not be loaded."
      );
    }

    setState(CameraState.CAMERA_ACTIVE, {
      trackLabel: stream.getVideoTracks()[0]
        ? stream.getVideoTracks()[0].label
        : "(unknown)",
    });
    setState(CameraState.SUBJECT_NOT_DETECTED);

    onLog("Camera streaming (in-memory only). Tracks:", stream.getTracks().map((t) => ({
      kind: t.kind,
      readyState: t.readyState,
      label: t.label,
    })));

    return { ok: true };
  }

  /**
   * HARD STOP: end every track, detach stream, stop detection loop.
   * Hiding <video> is NOT enough — tracks must be stopped explicitly.
   * @param {{ silent?: boolean, nextState?: string }} [opts]
   */
  async function stopCamera(opts) {
    const silent = opts && opts.silent;
    const nextState = (opts && opts.nextState) || CameraState.CAMERA_OFF;

    shuttingDown = true;
    stopDetection();

    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
          onLog("Stopped track: " + track.kind + " / " + track.readyState);
        } catch (err) {
          onLog("Error stopping track", err);
        }
      });
      mediaStream = null;
    }

    if (videoEl) {
      try {
        videoEl.pause();
      } catch (_) {
        /* ignore */
      }
      videoEl.srcObject = null;
      try {
        videoEl.removeAttribute("src");
        videoEl.load();
      } catch (_) {
        /* ignore */
      }
    }

    if (!silent) {
      setState(nextState);
      onLog("Camera fully stopped. No stream retained.");
    } else {
      state = nextState;
    }

    // Allow a tick for any late "ended" events to see shuttingDown=true
    setTimeout(() => {
      shuttingDown = false;
    }, 0);
  }

  /**
   * Begin looking for a face. Calls onPresence(true) once streak met.
   * @param {(detected: boolean) => void} presenceCallback
   */
  function startDetection(presenceCallback) {
    onPresence = presenceCallback;
    detectionActive = true;
    detectStreak = 0;
    lastVideoTime = -1;
    lastDetectMs = 0;
    onLog("Face presence detection started (boolean only — no identification).");
    loopDetect();
  }

  function stopDetection() {
    detectionActive = false;
    onPresence = null;
    detectStreak = 0;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function markScanning() {
    stopDetection();
    setState(CameraState.SCANNING);
  }

  function markResult() {
    // Caller should have stopped camera; state only
    setState(CameraState.RESULT);
  }

  function markSubjectDetected() {
    setState(CameraState.SUBJECT_DETECTED);
  }

  function loopDetect() {
    if (!detectionActive) return;

    rafId = requestAnimationFrame(loopDetect);

    if (!faceDetector || !detectorReady) return;
    if (!videoEl || videoEl.readyState < 2) return;

    const now = performance.now();
    if (now - lastDetectMs < DETECT_MIN_INTERVAL_MS) return;
    if (videoEl.currentTime === lastVideoTime) return;

    lastVideoTime = videoEl.currentTime;
    lastDetectMs = now;

    let result;
    try {
      result = faceDetector.detectForVideo(videoEl, now);
    } catch (err) {
      onLog("detectForVideo error", err);
      return;
    }

    const hasFace =
      result && result.detections && result.detections.length > 0;

    // Do not log every frame (noisy); log transitions only via streak edges
    if (hasFace) {
      detectStreak += 1;
      if (detectStreak === 1) {
        onLog("Face candidates appearing…");
      }
      if (detectStreak >= DETECT_STREAK_REQUIRED) {
        detectionActive = false;
        markSubjectDetected();
        onLog("SUBJECT DETECTED (presence only). Detection loop stopping.");
        if (onPresence) onPresence(true);
      }
    } else {
      if (detectStreak > 0) {
        onLog("Face presence lost; streak reset.");
      }
      detectStreak = 0;
      if (state !== CameraState.SUBJECT_NOT_DETECTED && state !== CameraState.CAMERA_ACTIVE) {
        // Stay in SUBJECT_NOT_DETECTED while waiting
      }
      if (onPresence) {
        // Optional continuous false callbacks not needed; keep quiet
      }
    }
  }

  function fail(code, message) {
    lastErrorCode = code;
    lastErrorMessage = message;
    console.error("[Camera] ERROR", code, message);
    setState(CameraState.ERROR, { code, message });
    return { ok: false, code, message };
  }

  return {
    CameraState,
    getState,
    getLastError,
    getPrivacyCopy,
    isCameraStreaming,
    startCamera,
    stopCamera,
    startDetection,
    stopDetection,
    markScanning,
    markResult,
    markSubjectDetected,
    ensureFaceDetector,
  };
}

  global.MonsterScannerCamera = {
    CameraState,
    createCameraController,
    probeCameraAvailability,
  };
})(window);
