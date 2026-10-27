/**
 * Bio-Spectral Entity Analyzer — app.js (v0.4)
 * ------------------------------------------------
 * Theatrical Halloween scanner + privacy-preserving local camera.
 *
 * Screen flow (v0.4):
 *   STANDBY (optical sensor toggle: camera on/off)
 *     → INITIATE SCAN
 *     → [camera ON] permission → positioning → subject detected
 *     → [camera OFF] skip camera; shuttered simulated scan
 *     → theatrical SCANNING (~6.5s)
 *     → stop all camera tracks (if any)
 *     → RESULT (fictional random classification)
 *     → auto-reset or Scan Again
 *
 * Privacy:
 *   Camera frames stay in this browser tab only.
 *   Face detection runs locally from vendored MediaPipe WASM (no CDN).
 *   No photos, recordings, uploads, analytics, or identification.
 *   Designed for an air-gapped Raspberry Pi nginx hotspot.
 */

(() => {
  "use strict";

  const CameraAPI = window.MonsterScannerCamera;
  if (!CameraAPI) {
    console.error("[MonsterScanner] camera.js did not load. Simulated scan only.");
  }
  const CameraState = (CameraAPI && CameraAPI.CameraState) || {
    CAMERA_OFF: "CAMERA_OFF",
    ERROR: "ERROR",
    RESULT: "RESULT",
  };
  const createCameraController =
    (CameraAPI && CameraAPI.createCameraController) ||
    function createMissingCamera() {
      return {
        getState: () => CameraState.CAMERA_OFF,
        getPrivacyCopy: () => ({
          primary: "No images are stored or transmitted.",
          secondary: "Camera module unavailable — simulated scan only.",
        }),
        isCameraStreaming: () => false,
        startCamera: async () => ({ ok: false, code: "UNSUPPORTED" }),
        stopCamera: async () => {},
        startDetection: () => {},
        stopDetection: () => {},
        markScanning: () => {},
        markResult: () => {},
      };
    };

  // ===========================================================================
  // MONSTER CATALOG (unchanged fictional game data)
  // ===========================================================================

  /**
   * @typedef {Object} Monster
   * @property {string} id
   * @property {string} name
   * @property {string} icon
   * @property {string} [emoji]
   * @property {boolean} [isOther]
   * @property {{key: string, value: string}[]} metrics
   * @property {string} recommendation
   * @property {string[]} [blurbs]
   */

  /** @type {Monster[]} */
  const MONSTER_DATA = [
    {
      id: "werewolf",
      name: "WEREWOLF",
      icon: "icons/werewolf.png",
      metrics: [
        { key: "LYCANTHROPIC ACTIVITY", value: "EXTREME" },
        { key: "LUNAR SENSITIVITY", value: "ELEVATED" },
        { key: "FUR DETECTION", value: "SUSPICIOUS" },
        { key: "HOWLING POTENTIAL", value: "HIGH" },
      ],
      recommendation:
        "Recommended action: Keep away from full moons. And maybe a brush.",
    },
    {
      id: "witch",
      name: "WITCH",
      icon: "icons/witch.png",
      metrics: [
        { key: "SPELL RESIDUE", value: "POTENT" },
        { key: "BROOM AFFINITY", value: "CONFIRMED" },
        { key: "CAULDRON INDEX", value: "BUBBLING" },
        { key: "HEX CAPACITY", value: "NON-TRIVIAL" },
      ],
      recommendation:
        "Recommended action: Offer candy respectfully. Do not insult the hat.",
    },
    {
      id: "zombie",
      name: "ZOMBIE",
      icon: "icons/zombie.png",
      metrics: [
        { key: "MOTOR FUNCTION", value: "DEGRADED" },
        { key: "BRAIN CRAVING", value: "ACTIVE" },
        { key: "DECOMPOSITION RATE", value: "FASHIONABLE" },
        { key: "GROAN FREQUENCY", value: "STANDARD" },
      ],
      recommendation:
        "Recommended action: Slow walking lanes only. Avoid salad bars.",
    },
    {
      id: "ghost",
      name: "GHOST",
      icon: "icons/ghost.png",
      metrics: [
        { key: "CORPOREAL DENSITY", value: "NEAR ZERO" },
        { key: "CHAIN RATTLE", value: "OPTIONAL" },
        { key: "WALL PHASE CAPABILITY", value: "LIKELY" },
        { key: "BOO FACTOR", value: "CLASSIC" },
      ],
      recommendation:
        "Recommended action: Provide blank sheets. Avoid vacuum cleaners.",
    },
    {
      id: "vampire",
      name: "VAMPIRE",
      icon: "icons/vampire.png",
      metrics: [
        { key: "FANG STATUS", value: "PRESENT" },
        { key: "GARLIC TOLERANCE", value: "CRITICAL FAILURE" },
        { key: "MIRROR RESPONSE", value: "ABSENT" },
        { key: "CAPE DRAMA", value: "MAXIMUM" },
      ],
      recommendation:
        "Recommended action: Schedule all meetings after sunset. No stake-outs.",
    },
    {
      id: "skeleton",
      name: "SKELETON",
      icon: "icons/skeleton.png",
      metrics: [
        { key: "CALCIUM LEVELS", value: "LITERAL" },
        { key: "FLESH COVERAGE", value: "0%" },
        { key: "RATTLE INDEX", value: "MUSICAL" },
        { key: "SPINE STATUS", value: "EXPOSED & PROUD" },
      ],
      recommendation:
        "Recommended action: Offer milk. Compliment the bone structure.",
    },
    {
      id: "pumpkin",
      name: "PUMPKIN",
      icon: "icons/pumpkin.png",
      metrics: [
        { key: "ORANGE SATURATION", value: "LEGENDARY" },
        { key: "INTERNAL CANDLE", value: "SUSPECTED" },
        { key: "SEED COUNT", value: "UNREASONABLE" },
        { key: "CARVING COMPLEXITY", value: "ARTISANAL" },
      ],
      recommendation:
        "Recommended action: Keep cool. Avoid pie-related conversations.",
    },
    {
      id: "other",
      name: "UNKNOWN",
      icon: "icons/other.png",
      isOther: true,
      metrics: [
        { key: "ENTITY MATCH", value: "NONE" },
        { key: "DATABASE HITS", value: "0" },
        { key: "CONFUSION LEVEL", value: "MAXIMUM" },
        { key: "OPERATOR DIGNITY", value: "COMPROMISED" },
      ],
      blurbs: [
        "The scanner has no idea what you are.",
        "This may be a software problem.",
        "Or possibly a you problem.",
      ],
      recommendation: "Please proceed to the candy distribution area.",
    },
  ];

  const SCAN_MESSAGES = [
    "Initializing bio-spectral analyzer…",
    "Calibrating paranormal sensors…",
    "Detecting supernatural anomalies…",
    "Analyzing cranial morphology…",
    "Measuring ectoplasmic residue…",
    "Checking lunar influence…",
    "Consulting ancient databases…",
    "Cross-referencing known entities…",
    "WARNING: Unusual readings detected…",
    "CLASSIFICATION IN PROGRESS…",
  ];

  const SCAN_DURATION_MS = 6800;
  const AUTO_RESET_MS = 18000;
  const MESSAGE_INTERVAL_MS = SCAN_DURATION_MS / SCAN_MESSAGES.length;
  /** Give guests time to step into frame before friendly timeout */
  const SUBJECT_WAIT_MS = 45000;
  const DETECTED_HOLD_MS = 1200;

  // ===========================================================================
  // DOM
  // ===========================================================================

  const screens = {
    standby: document.getElementById("screenStandby"),
    scanning: document.getElementById("screenScanning"),
    result: document.getElementById("screenResult"),
    error: document.getElementById("screenError"),
  };

  const els = {
    btnInitiate: document.getElementById("btnInitiate"),
    btnScanAgain: document.getElementById("btnScanAgain"),
    btnAbort: document.getElementById("btnAbort"),
    btnErrorStandby: document.getElementById("btnErrorStandby"),
    diagMessage: document.getElementById("diagMessage"),
    scanSubprompt: document.getElementById("scanSubprompt"),
    scanningStatus: document.getElementById("scanningStatus"),
    progressBlock: document.getElementById("progressBlock"),
    progressFill: document.getElementById("progressFill"),
    progressPct: document.getElementById("progressPct"),
    progressBar: document.getElementById("progressBar"),
    terminalLog: document.getElementById("terminalLog"),
    resultCard: document.getElementById("resultCard"),
    resultStatus: document.getElementById("resultStatus"),
    resetCountdown: document.getElementById("resetCountdown"),
    autoResetNote: document.getElementById("autoResetNote"),
    privacyNote: document.getElementById("privacyNote"),
    privacyPrimary: document.getElementById("privacyPrimary"),
    privacySecondary: document.getElementById("privacySecondary"),
    activeScanFrame: document.getElementById("activeScanFrame"),
    cameraVideo: document.getElementById("cameraVideo"),
    sweepBeam: document.getElementById("sweepBeam"),
    scanReticule: document.getElementById("scanReticule"),
    errorMessage: document.getElementById("errorMessage"),
    btnCameraToggle: document.getElementById("btnCameraToggle"),
    cameraToggleState: document.getElementById("cameraToggleState"),
    boneControl: document.getElementById("btnCameraToggle"),
    opticalSensorVal: document.getElementById("opticalSensorVal"),
    standbyPrompt: document.getElementById("standbyPrompt"),
    standbySubprompt: document.getElementById("standbySubprompt"),
    standbyScanFrame: document.getElementById("standbyScanFrame"),
    standbyStatus: document.getElementById("standbyStatus"),
  };

  const CAMERA_PREF_KEY = "dsa.opticalSensor";
  let cameraAvailable = false;
  let cameraEnabled = false;

  function readCameraPref() {
    try {
      const stored = window.localStorage.getItem(CAMERA_PREF_KEY);
      if (stored === "off") return false;
      if (stored === "on") return true;
    } catch (_) {
      /* private mode / blocked storage */
    }
    return true;
  }

  function writeCameraPref(enabled) {
    try {
      window.localStorage.setItem(CAMERA_PREF_KEY, enabled ? "on" : "off");
    } catch (_) {
      /* ignore */
    }
  }

  function isCameraEnabled() {
    return cameraEnabled && cameraAvailable;
  }

  function setCameraEnabled(enabled) {
    cameraEnabled = Boolean(enabled) && cameraAvailable;
    if (cameraAvailable) {
      writeCameraPref(cameraEnabled);
    }
    syncCameraToggleUI();
    updateCameraChrome();
    updatePrivacyBanner();
    console.info(
      "[MonsterScanner] Optical sensor",
      cameraEnabled ? "ENABLED" : "DISABLED",
      cameraAvailable ? "" : "(camera unavailable)"
    );
  }

  async function refreshCameraAvailability() {
    if (!CameraAPI || !CameraAPI.probeCameraAvailability) {
      cameraAvailable = false;
      cameraEnabled = false;
      return { available: false, reason: "NO_CAMERA_MODULE" };
    }
    const result = await CameraAPI.probeCameraAvailability();
    cameraAvailable = Boolean(result && result.available);
    if (!cameraAvailable) {
      cameraEnabled = false;
    } else {
      cameraEnabled = readCameraPref();
    }
    console.info("[MonsterScanner] Camera probe:", result);
    return result;
  }

  function syncCameraToggleUI() {
    const on = isCameraEnabled();
    if (els.btnCameraToggle) {
      els.btnCameraToggle.setAttribute("aria-checked", on ? "true" : "false");
      els.btnCameraToggle.classList.toggle("is-on", on);
      els.btnCameraToggle.classList.toggle("is-unavailable", !cameraAvailable);
      els.btnCameraToggle.disabled = !cameraAvailable;
      els.btnCameraToggle.setAttribute(
        "aria-disabled",
        cameraAvailable ? "false" : "true"
      );
    }
    if (els.boneControl) {
      els.boneControl.classList.toggle("is-on", on);
    }
    if (els.cameraToggleState) {
      els.cameraToggleState.textContent = !cameraAvailable
        ? "UNAVAILABLE"
        : on
          ? "CAMERA ON"
          : "CAMERA OFF";
    }
    if (els.opticalSensorVal) {
      els.opticalSensorVal.textContent = !cameraAvailable
        ? "UNAVAILABLE"
        : on
          ? "READY"
          : "DISABLED";
      els.opticalSensorVal.className =
        "sensor-val " + (on ? "ok" : "alert");
    }
    if (els.standbyPrompt) {
      els.standbyPrompt.textContent = on
        ? "Place subject within scanning area."
        : "Optical sensor offline.";
    }
    if (els.standbySubprompt) {
      els.standbySubprompt.textContent = on
        ? "Awaiting initiation sequence…"
        : "Simulated analysis ready — INITIATE SCAN still works.";
    }
    if (els.standbyScanFrame) {
      els.standbyScanFrame.classList.toggle("camera-offline", !on);
    }
    if (els.standbyStatus) {
      els.standbyStatus.textContent = on ? "STANDBY" : "STANDBY — NO CAMERA";
      els.standbyStatus.classList.toggle("status-offline", !on);
      els.standbyStatus.classList.toggle("status-standby", on);
    }
  }

  /** @type {number[]} */
  let scanTimers = [];
  /** @type {number|null} */
  let resetTimer = null;
  /** @type {number|null} */
  let countdownInterval = null;
  /** @type {number|null} */
  let subjectWaitTimer = null;
  /** @type {AudioContext|null} */
  let audioCtx = null;
  let forceNextId = null;
  let sessionBusy = false;

  // ===========================================================================
  // Camera controller (separate from monster classification)
  // ===========================================================================

  const camera = createCameraController({
    videoEl: els.cameraVideo,
    onStateChange: (state, detail) => {
      updatePrivacyBanner();
      updateCameraChrome();
      // Unexpected stream death while a session is open
      if (
        state === CameraState.ERROR &&
        detail &&
        detail.code === "STREAM_ENDED" &&
        sessionBusy
      ) {
        showFriendlyError(ERROR_COPY.STREAM_ENDED, "STREAM_ENDED");
      }
    },
    onLog: (msg, data) => {
      if (data !== undefined && data !== null) console.info("[Camera]", msg, data);
      else console.info("[Camera]", msg);
    },
  });

  function updatePrivacyBanner() {
    const streaming = camera.isCameraStreaming();
    let copy = camera.getPrivacyCopy();

    if (!isCameraEnabled() && !streaming) {
      copy = {
        primary: "No images are stored or transmitted.",
        secondary: cameraAvailable
          ? "Optical sensor disabled — simulated scan only."
          : "No camera on this device — simulated scan only.",
      };
    }

    els.privacyPrimary.textContent = copy.primary;
    if (copy.secondary) {
      els.privacySecondary.textContent = copy.secondary;
      els.privacySecondary.hidden = false;
    } else {
      els.privacySecondary.textContent = "";
      els.privacySecondary.hidden = true;
    }

    els.privacyNote.classList.toggle("is-camera-active", streaming);
    els.privacyNote.classList.toggle(
      "is-camera-off-post",
      !streaming && camera.getState() === CameraState.RESULT
    );
  }

  function updateCameraChrome() {
    const streaming = camera.isCameraStreaming();
    els.activeScanFrame.classList.toggle("camera-on", streaming);
    els.activeScanFrame.classList.toggle(
      "camera-offline",
      !streaming && !isCameraEnabled()
    );
  }

  // ===========================================================================
  // Screens
  // ===========================================================================

  /** @param {"standby"|"scanning"|"result"|"error"} name */
  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      const active = key === name;
      el.classList.toggle("screen-active", active);
      if (active) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "");
    });
  }

  function clearScanTimers() {
    scanTimers.forEach((id) => clearTimeout(id));
    scanTimers = [];
  }

  function clearResetTimers() {
    if (resetTimer !== null) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
    if (countdownInterval !== null) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function clearSubjectWait() {
    if (subjectWaitTimer !== null) {
      clearTimeout(subjectWaitTimer);
      subjectWaitTimer = null;
    }
  }

  // ===========================================================================
  // Optional UI sounds
  // ===========================================================================

  function getAudioContext() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  function beep(freq, duration, type = "square", gain = 0.04) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = gain;
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (_) {
      /* optional */
    }
  }

  const sound = {
    click: () => beep(440, 0.06, "square", 0.035),
    tick: () => beep(660, 0.04, "triangle", 0.025),
    warn: () => beep(220, 0.12, "sawtooth", 0.03),
    success: () => {
      beep(523, 0.08, "square", 0.04);
      setTimeout(() => beep(784, 0.12, "square", 0.035), 90);
    },
    fail: () => {
      beep(180, 0.2, "sawtooth", 0.04);
      setTimeout(() => beep(120, 0.25, "sawtooth", 0.035), 140);
    },
  };

  // ===========================================================================
  // Classification (fictional / random — NOT based on appearance)
  // ===========================================================================

  function classifyEntity() {
    if (forceNextId) {
      const forced = MONSTER_DATA.find((m) => m.id === forceNextId);
      forceNextId = null;
      if (forced) return forced;
    }
    return MONSTER_DATA[Math.floor(Math.random() * MONSTER_DATA.length)];
  }

  function fakeConfidence(monster) {
    if (monster.isOther) return (Math.random() * 8 + 1).toFixed(1);
    return (Math.random() * 8 + 91).toFixed(1);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** @param {Monster} monster */
  function renderResult(monster) {
    const confidence = fakeConfidence(monster);
    const isOther = Boolean(monster.isOther);

    els.resultCard.classList.toggle("is-other", isOther);
    els.resultStatus.textContent = isOther
      ? "CLASSIFICATION FAILED"
      : "CLASSIFIED";
    els.resultStatus.classList.toggle("status-failed", isOther);
    els.resultStatus.classList.toggle("status-classified", !isOther);

    const boxLabel = isOther
      ? `╔══════════════════════════════╗
ENTITY CLASSIFICATION: FAILED
╚══════════════════════════════╝`
      : `╔══════════════════════════════╗
ENTITY CLASSIFIED
╚══════════════════════════════╝`;

    const metricsHtml = monster.metrics
      .map(
        (m) =>
          `<li><span class="metric-key">${escapeHtml(m.key)}</span>` +
          `<span class="metric-val">${escapeHtml(m.value)}</span></li>`
      )
      .join("");

    let extra = "";
    if (isOther && monster.blurbs) {
      extra =
        `<div class="other-blurb">` +
        `<p><strong>UNKNOWN LIFEFORM DETECTED</strong></p>` +
        monster.blurbs
          .map(
            (b, i) =>
              `<p class="${i > 0 ? "dim" : ""}">${escapeHtml(b)}</p>`
          )
          .join("") +
        `</div>`;
    }

    els.resultCard.innerHTML = `
      <div class="result-box ${isOther ? "failed" : ""}">${boxLabel}</div>
      <div class="result-monster">
        <img class="result-icon" src="${escapeHtml(monster.icon)}" alt="" width="160" height="160" />
        <h2 class="result-name ${isOther ? "failed" : ""}">${escapeHtml(monster.name)}</h2>
      </div>
      ${extra}
      <ul class="result-metrics">${metricsHtml}</ul>
      <p class="confidence">CONFIDENCE: ${confidence}%</p>
      <p class="recommendation ${isOther ? "failed" : ""}">${escapeHtml(monster.recommendation)}</p>
    `;
  }

  // ===========================================================================
  // Scan UI helpers
  // ===========================================================================

  function resetScanUI() {
    els.diagMessage.textContent = SCAN_MESSAGES[0];
    els.scanSubprompt.textContent = "";
    els.progressFill.style.width = "0%";
    els.progressPct.textContent = "0%";
    els.progressBar.setAttribute("aria-valuenow", "0");
    els.terminalLog.textContent = "";
    els.progressBlock.hidden = true;
    els.sweepBeam.hidden = true;
    els.scanReticule.classList.remove("active");
    els.btnAbort.hidden = true;
    els.scanningStatus.textContent = "SCANNING";
    els.scanningStatus.className = "status-value status-scanning";
  }

  function appendTerminal(text, className) {
    const line = document.createElement("div");
    if (className) line.className = className;
    const stamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    line.textContent = `[${stamp}] ${text}`;
    els.terminalLog.appendChild(line);
    if (els.terminalLog.parentElement) {
      els.terminalLog.parentElement.scrollTop =
        els.terminalLog.parentElement.scrollHeight;
    }
  }

  function setScanningStatus(text, className) {
    els.scanningStatus.textContent = text;
    els.scanningStatus.className = "status-value " + className;
  }

  // ===========================================================================
  // Friendly errors
  // ===========================================================================

  function showFriendlyError(userMessage, technicalCode) {
    sessionBusy = false;
    clearScanTimers();
    clearSubjectWait();
    console.error("[MonsterScanner] Friendly error:", technicalCode, userMessage);
    els.errorMessage.textContent = userMessage;
    showScreen("error");
    updatePrivacyBanner();
  }

  const ERROR_COPY = {
    PERMISSION_DENIED: "Camera access was not granted.",
    UNSUPPORTED: "This device cannot open the supernatural sensor.",
    NO_CAMERA: "No camera was found on this device.",
    CAMERA_BUSY: "The camera is busy or could not start.",
    CAMERA_ERROR: "Camera access was not granted.",
    PLAY_FAILED: "The camera could not start on this browser.",
    DETECTOR_FAILED: "Local analysis module failed to load. Check network for first-time setup.",
    INSECURE_CONTEXT: "Please open this app via localhost or HTTPS (not a file:// link).",
    STREAM_ENDED: "The camera stopped unexpectedly.",
    SUBJECT_TIMEOUT: "No subject detected in the scanning area.",
  };

  // ===========================================================================
  // Main flow: permission → positioning → detect → theatrical scan → stop
  // ===========================================================================

  async function beginSession() {
    if (sessionBusy) return;
    sessionBusy = true;

    clearScanTimers();
    clearResetTimers();
    clearSubjectWait();
    sound.click();
    resetScanUI();
    showScreen("scanning");

    if (!isCameraEnabled()) {
      startSimulatedScan(
        cameraAvailable
          ? "Optical sensor disabled — no camera access requested."
          : "Camera unavailable — simulated scan only."
      );
      return;
    }

    setScanningStatus("REQUESTING ACCESS", "status-scanning");
    els.diagMessage.textContent = "Initializing camera sensors…";
    els.scanSubprompt.textContent = "Permission may be required.";
    els.btnAbort.hidden = false;
    appendTerminal("Scan sequence initiated.");
    appendTerminal("Privacy mode: local camera + local face presence only.");

    const started = await camera.startCamera();
    if (!started.ok) {
      await camera.stopCamera({ silent: true, nextState: CameraState.CAMERA_OFF });
      if (started.code === "NO_CAMERA" || started.code === "UNSUPPORTED" || started.code === "INSECURE_CONTEXT") {
        cameraAvailable = false;
        cameraEnabled = false;
      } else {
        cameraEnabled = false;
      }
      syncCameraToggleUI();
      updateCameraChrome();
      updatePrivacyBanner();
      appendTerminal(
        "Camera could not start (" + started.code + ") — falling back to simulated scan."
      );
      startSimulatedScan("Fallback: theatrical analysis only.");
      return;
    }

    enterPositioning();
  }

  function startSimulatedScan(reason) {
    setScanningStatus("SIMULATED SCAN", "status-scanning");
    els.diagMessage.textContent = "Optical sensor bypassed…";
    els.scanSubprompt.textContent = "Running theatrical analysis only.";
    els.btnAbort.hidden = false;
    appendTerminal("Scan sequence initiated.");
    if (reason) appendTerminal(reason);
    updateCameraChrome();
    startTheatricalScan();
  }

  function enterPositioning() {
    setScanningStatus("SUBJECT POSITIONING", "status-positioning");
    els.diagMessage.textContent = "Camera initialized.";
    els.scanSubprompt.textContent = "Awaiting subject…";
    els.progressBlock.hidden = true;
    els.sweepBeam.hidden = true;
    els.scanReticule.classList.remove("active");
    els.btnAbort.hidden = false;
    appendTerminal("Camera active — local processing only.");
    appendTerminal("Awaiting subject within scanning area…");
    updatePrivacyBanner();
    updateCameraChrome();

    clearSubjectWait();
    subjectWaitTimer = setTimeout(() => {
      console.warn("[MonsterScanner] Subject wait timed out");
      camera.stopCamera({ nextState: CameraState.ERROR }).then(() => {
        updateCameraChrome();
        updatePrivacyBanner();
        showFriendlyError(ERROR_COPY.SUBJECT_TIMEOUT, "SUBJECT_TIMEOUT");
      });
    }, SUBJECT_WAIT_MS);

    camera.startDetection(() => {
      clearSubjectWait();
      onSubjectDetected();
    });
  }

  function onSubjectDetected() {
    if (!sessionBusy) return;

    sound.success();
    setScanningStatus("SUBJECT DETECTED", "status-detected");
    els.diagMessage.textContent = "SUBJECT DETECTED";
    els.scanSubprompt.textContent = "BIOSPECTRAL ANALYSIS READY";
    appendTerminal("SUBJECT DETECTED (presence only — not identified).", "line-warn");
    appendTerminal("BIOSPECTRAL ANALYSIS READY");

    const holdId = setTimeout(() => {
      startTheatricalScan();
    }, DETECTED_HOLD_MS);
    scanTimers.push(holdId);
  }

  function startTheatricalScan() {
    if (camera.isCameraStreaming()) {
      camera.markScanning();
    }
    setScanningStatus("SCANNING", "status-scanning");
    els.btnAbort.hidden = true;
    els.progressBlock.hidden = false;
    els.sweepBeam.hidden = false;
    els.scanReticule.classList.add("active");
    els.scanSubprompt.textContent = "";
    appendTerminal("Theatrical analysis running (classification is fictional/random).");

    SCAN_MESSAGES.forEach((msg, i) => {
      const id = setTimeout(() => {
        els.diagMessage.textContent = msg;
        const isWarn = /WARNING|CLASSIFICATION/i.test(msg);
        appendTerminal(msg, isWarn ? "line-alert" : i > 6 ? "line-warn" : "");
        if (isWarn) sound.warn();
        else sound.tick();
      }, i * MESSAGE_INTERVAL_MS);
      scanTimers.push(id);
    });

    const steps = 20;
    for (let s = 1; s <= steps; s++) {
      const id = setTimeout(() => {
        const pct = Math.round((s / steps) * 100);
        els.progressFill.style.width = pct + "%";
        els.progressPct.textContent = pct + "%";
        els.progressBar.setAttribute("aria-valuenow", String(pct));
      }, (SCAN_DURATION_MS / steps) * s);
      scanTimers.push(id);
    }

    const finishId = setTimeout(() => {
      finishScan(classifyEntity());
    }, SCAN_DURATION_MS);
    scanTimers.push(finishId);
  }

  /** @param {Monster} monster */
  async function finishScan(monster) {
    clearScanTimers();
    appendTerminal(
      monster.isOther
        ? "Classification failed — unknown entity signature."
        : "Entity matched: " + monster.name,
      monster.isOther ? "line-alert" : "line-warn"
    );
    if (camera.isCameraStreaming()) {
      appendTerminal("Shutting down camera tracks…");
    } else {
      appendTerminal("No camera session to close.");
    }

    // CRITICAL: stop every track before showing result
    await camera.stopCamera({ nextState: CameraState.RESULT });
    camera.markResult();
    updateCameraChrome();
    updatePrivacyBanner();

    if (monster.isOther) sound.fail();
    else sound.success();

    renderResult(monster);
    showScreen("result");
    sessionBusy = false;
    beginAutoReset();
  }

  // ===========================================================================
  // Auto-reset / standby
  // ===========================================================================

  function beginAutoReset() {
    clearResetTimers();
    let remaining = Math.round(AUTO_RESET_MS / 1000);
    els.resetCountdown.textContent = String(remaining);
    els.autoResetNote.hidden = false;

    countdownInterval = setInterval(() => {
      remaining -= 1;
      els.resetCountdown.textContent = String(Math.max(0, remaining));
      if (remaining <= 0 && countdownInterval !== null) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }, 1000);

    resetTimer = setTimeout(goStandby, AUTO_RESET_MS);
  }

  async function goStandby() {
    sessionBusy = false;
    clearScanTimers();
    clearResetTimers();
    clearSubjectWait();
    await camera.stopCamera({ nextState: CameraState.CAMERA_OFF });
    updateCameraChrome();
    resetScanUI();
    showScreen("standby");
    updatePrivacyBanner();
  }

  async function abortToStandby() {
    sound.click();
    console.info("[MonsterScanner] User aborted to standby — stopping camera.");
    await goStandby();
  }

  // ===========================================================================
  // Lifecycle: always stop camera when leaving / hiding the page
  // ===========================================================================

  function bindLifecycleShutdown() {
    const shutdown = (reason) => {
      console.info("[MonsterScanner] Lifecycle shutdown:", reason);
      camera.stopCamera({ silent: true, nextState: CameraState.CAMERA_OFF });
      updateCameraChrome();
    };

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        shutdown("visibility hidden");
      }
    });

    window.addEventListener("pagehide", () => shutdown("pagehide"));
    window.addEventListener("beforeunload", () => shutdown("beforeunload"));
  }

  // ===========================================================================
  // Init
  // ===========================================================================

  async function init() {
    if (els.btnCameraToggle) {
      els.btnCameraToggle.addEventListener("click", (event) => {
        event.preventDefault();
        if (!cameraAvailable) return;
        sound.click();
        setCameraEnabled(!cameraEnabled);
      });
    } else {
      console.error("[MonsterScanner] Optical sensor toggle was not found in the page.");
    }

    await refreshCameraAvailability();
    syncCameraToggleUI();
    updateCameraChrome();
    updatePrivacyBanner();

    els.btnInitiate.addEventListener("click", () => {
      beginSession();
    });

    els.btnScanAgain.addEventListener("click", () => {
      clearResetTimers();
      beginSession();
    });

    els.btnAbort.addEventListener("click", () => {
      abortToStandby();
    });

    els.btnErrorStandby.addEventListener("click", () => {
      abortToStandby();
    });

    const unlockAudio = () => {
      getAudioContext();
    };
    document.addEventListener("touchstart", unlockAudio, {
      once: true,
      passive: true,
    });
    document.addEventListener("click", unlockAudio, { once: true });

    bindLifecycleShutdown();
    showScreen("standby");
    updateCameraChrome();
    updatePrivacyBanner();

    console.info(
      "[MonsterScanner] v0.4 ready. Camera available:",
      cameraAvailable,
      "| Secure context:",
      window.isSecureContext
    );

    window.MonsterScanner = {
      version: "0.4",
      monsters: MONSTER_DATA,
      CameraState,
      getCameraState: () => camera.getState(),
      isCameraStreaming: () => camera.isCameraStreaming(),
      isCameraEnabled,
      forceNext(id) {
        forceNextId = id;
        console.info("[MonsterScanner] Next classification forced to:", id);
      },
      /** Dev: force stop camera tracks */
      stopCamera() {
        return camera.stopCamera({ nextState: CameraState.CAMERA_OFF });
      },
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
