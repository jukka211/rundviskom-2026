// rundviskom — generative Instagram-format tool
//
// UI markup lives in index.html and is styled in style.css; this sketch only
// wires behaviour to those elements and draws the canvas.
//
// MP4 recording (desktop) needs mp4-muxer, loaded in index.html:
//   <script src="https://cdn.jsdelivr.net/npm/mp4-muxer"></script>
//
// Video export sizes (all recording paths render at exactly these):
//   story -> 1080x1920    post -> 1080x1350    at 40 Mbps H.264.
// WebCodecs is preferred when available; MediaRecorder records the same
// exact-size offscreen render buffer on mobile and fallback browsers.

let phraseText = "rundviskom  ";

const PALETTE = ["#FFE429", "#FF1B8A", "#FF4B18", "#0DB254", "#0033C0"];
const BG_COLORS = ["#FFFFFF", "#FFE429", "#FF1B8A", "#FF4B18", "#0DB254", "#B4B4B4"];

// layout coordinates + exact mp4 output size (same aspect ratio => no distortion)
const SIZES = {
  story: { w: 1440, h: 2560, label: "Story (1440x2560)", mp4: { w: 1080, h: 1920 } },
  post: { w: 1152, h: 1440, label: "Post (1152x1440)", mp4: { w: 1080, h: 1350 } },
};

const EXPORT_PIXEL_DENSITY = 2;

// column sizing (kept in sync with --app-max / --app-pad in style.css)
const APP_MAX_W = 480;
const APP_PAD = 12;

function previewPixelDensity() {
  return Math.min(3, Math.max(2, window.devicePixelRatio || 1));
}

// saved "rundviskom" layouts (letter order: r u n d v i s k o m), in width-units
const LAYOUTS = [
  {
    r: 0.186,
    pts: [
      [0.3701, 0.2287], [0.5668, 0.4284], [0.5035, 0.6603],
      [0.7616, 0.6827], [0.7961, 0.9482], [0.5348, 0.9925],
      [0.2959, 1.1115], [0.2409, 1.347], [0.3757, 1.5794],
      [0.6372, 1.5707],
    ],
  },
  {
    r: 0.178,
    pts: [
      [0.1461, 0.3506], [0.3439, 0.2178], [0.5515, 0.3687],
      [0.7421, 0.551], [0.6696, 0.8029], [0.4551, 0.9361],
      [0.2774, 1.145], [0.4333, 1.3345], [0.6706, 1.2135],
      [0.8482, 1.3884],
    ],
  },
  {
    r: 0.1748,
    pts: [
      [0.1905, 0.628], [0.2855, 0.4043], [0.4995, 0.2385],
      [0.7228, 0.3759], [0.8052, 0.6235], [0.788, 0.8569],
      [0.6105, 1.0503], [0.3658, 1.1613], [0.2304, 1.3817],
      [0.3399, 1.6005],
    ],
  },
];

const AUTO_SPACING = 1.22;

let currentSize = "story";
let canvasW = SIZES[currentSize].w;
let canvasH = SIZES[currentSize].h;

let letterIndex = 0;
let phraseCount = 0;
let currentCol = PALETTE[0];
let textJustChanged = false;
let circles = [];
let autoCircles = [];
let autoCol = PALETTE[0];
let lastX = null;
let lastY = null;

let linzFont;

const DIST_RATIO = 1.5;
const circleR = 200;
let drawMode = "letters";
let eraser = false;

let autoLayout = false;
let currentLayoutIndex = -1;

let loadedImages = [];
let imgIndex = 0;

// background
let bgMode = "color"; // "color" | "image" | "video"
let bgColor = "#FFFFFF";
let bgImage = null;
let bgVideo = null;

// fixed overlay texture (background-image.png), multiplied over the background
let overlayImage = null;
let overlayEnabled = true;

// canvas + preview scaling
let cnv;
let canvasHolder;
let displayScale = 1;
let previewW = 1;
let previewH = 1;

// UI elements (resolved from the DOM in wireUI)
let accordionBody, accordionOpen = false;
let textInput, modeButton, eraserButton;
let imgFileInput, imagesField, autoButton, regenButton;
let bgColorSelect, bgButton, bgFileInput, overlayButton, sizeSelect;
let exportButton, recordButton, saveVideoButton, recStatus, clearButton;

// last finished recording, held so a fresh tap can save it on mobile
let lastVideoBlob = null;
let lastVideoName = "";
let lastVideoType = "video/mp4";

// ---- video recording ----
let isRecording = false;
let recMode = null; // "webcodecs" | "mediarecorder"
let mp4Muxer = null;
let mp4Encoder = null;
let mediaRecorder = null;
let recordedChunks = [];
let recStream = null;
let recGraphics = null;
let recStartTime = 0;
let recFrameCount = 0;
let recLastCapture = 0;
let recFinished = false;
const REC_FPS = 30;
const REC_BITRATE = 40_000_000; // 40 Mbps

function preload() {
  linzFont = loadFont("LinzSans-Medium.ttf");

  // overlay texture; if it fails to load it simply isn't drawn
  overlayImage = loadImage(
    "/background-image.png",
    () => {},
    () => {
      overlayImage = null;
    }
  );
}

function setup() {
  canvasHolder = document.getElementById("canvas-holder");

  pixelDensity(previewPixelDensity());
  recalcDisplayScale();

  cnv = createCanvas(previewW, previewH);
  cnv.parent(canvasHolder);
  cnv.style("display", "block");
  cnv.style("touch-action", "none");
  cnv.style("user-select", "none");
  cnv.style("-webkit-user-select", "none");

  applyCtxDefaults();
  pickPhraseColor();
  wireUI();
  relayout();
}

function applyCtxDefaults() {
  textAlign(CENTER, CENTER);
  if (linzFont) textFont(linzFont);
  imageMode(CENTER);
}

function isMobile() {
  return window.matchMedia("(pointer: coarse), (max-width: 820px)").matches;
}

function isIOSLike() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function recalcDisplayScale() {
  canvasW = SIZES[currentSize].w;
  canvasH = SIZES[currentSize].h;

  const availW = Math.max(1, Math.min(window.innerWidth, APP_MAX_W) - APP_PAD * 2);
  const availH = Math.max(1, Math.round(window.innerHeight * 0.72));

  displayScale = Math.min(availW / canvasW, availH / canvasH, 1);
  previewW = Math.max(1, Math.round(canvasW * displayScale));
  previewH = Math.max(1, Math.round(canvasH * displayScale));
}

function relayout() {
  if (!cnv) return;
  recalcDisplayScale();
  resizeCanvas(previewW, previewH);
  applyCtxDefaults();
  if (autoLayout) applyLayout();
}

// ---- wire DOM controls to behaviour ----
function wireUI() {
  accordionBody = document.getElementById("accordion-body");
  const accToggle = document.getElementById("accordion-toggle");
  accToggle.addEventListener("click", toggleAccordion);

  textInput = document.getElementById("text-input");
  textInput.value = "rundviskom";
  textInput.addEventListener("input", updateText);

  modeButton = document.getElementById("mode-button");
  modeButton.addEventListener("click", toggleMode);

  eraserButton = document.getElementById("eraser-button");
  eraserButton.addEventListener("click", toggleEraser);

  imagesField = document.getElementById("images-field");
  imgFileInput = document.getElementById("img-file-input");
  imgFileInput.addEventListener("change", loadSelectedImages);

  autoButton = document.getElementById("auto-button");
  autoButton.addEventListener("click", toggleAutoLayout);

  regenButton = document.getElementById("regen-button");
  regenButton.addEventListener("click", generateAutoLayout);

  bgColorSelect = document.getElementById("bg-color-select");
  BG_COLORS.forEach((c) => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    bgColorSelect.appendChild(o);
  });
  bgColorSelect.value = bgColor;
  bgColorSelect.addEventListener("change", () => {
    bgColor = bgColorSelect.value;
    bgMode = "color";
    bgButton.textContent = "BG: COLOR";
    updateVisibility();
  });

  bgButton = document.getElementById("bg-button");
  bgButton.textContent = bgMode === "image" ? "BG: IMAGE" : "BG: COLOR";
  bgButton.addEventListener("click", toggleBg);

  bgFileInput = document.getElementById("bg-file-input");
  bgFileInput.addEventListener("change", handleBgFile);

  overlayButton = document.getElementById("overlay-button");
  overlayButton.textContent = overlayEnabled ? "Overlay: ON" : "Overlay: OFF";
  overlayButton.classList.toggle("on", overlayEnabled);
  overlayButton.addEventListener("click", toggleOverlay);

  sizeSelect = document.getElementById("size-select");
  for (const key in SIZES) {
    const o = document.createElement("option");
    o.value = key;
    o.textContent = SIZES[key].label;
    sizeSelect.appendChild(o);
  }
  sizeSelect.value = currentSize;
  sizeSelect.addEventListener("change", () => switchSize(sizeSelect.value));

  exportButton = document.getElementById("export-button");
  exportButton.addEventListener("click", exportImage);

  recordButton = document.getElementById("record-button");
  recordButton.addEventListener("click", toggleRecording);

  saveVideoButton = document.getElementById("save-video-button");
  // native click carries the user activation navigator.share needs
  saveVideoButton.addEventListener("click", saveLastVideo);

  recStatus = document.getElementById("rec-status");

  clearButton = document.getElementById("clear-button");
  clearButton.addEventListener("click", clearCanvas);

  updateVisibility();
}

function toggleAccordion() {
  accordionOpen = !accordionOpen;
  accordionBody.hidden = !accordionOpen;
  const toggle = document.getElementById("accordion-toggle");
  const icon = document.getElementById("accordion-icon");
  if (icon) icon.textContent = accordionOpen ? "Close \u2212" : "Open +";
  if (toggle) toggle.setAttribute("aria-expanded", accordionOpen ? "true" : "false");
}

function updateVisibility() {
  // Images picker only matters in IMAGES draw mode
  imagesField.hidden = drawMode !== "images";
  // media picker only for image/video backgrounds
  bgFileInput.hidden = !(bgMode === "image" || bgMode === "video");
  // "new random curve" only while auto-layout is on
  regenButton.hidden = !autoLayout;
}

// ---- file handlers ----
function loadSelectedImages() {
  const files = Array.from(imgFileInput.files || []);
  loadedImages = [];
  imgIndex = 0;

  files.forEach((file) => {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    loadImage(
      url,
      (img) => {
        loadedImages.push(img);
        URL.revokeObjectURL(url);
      },
      () => URL.revokeObjectURL(url)
    );
  });
}

function handleBgFile() {
  const file = bgFileInput.files && bgFileInput.files[0];
  if (!file) return;

  const type = file.type || "";

  if (type.startsWith("video/")) {
    loadBgVideo(file);
    return;
  }

  if (type.startsWith("image/")) {
    const url = URL.createObjectURL(file);
    loadImage(
      url,
      (img) => {
        clearBgVideo();
        bgImage = img;
        bgMode = "image";
        bgButton.textContent = "BG: IMAGE";
        updateVisibility();
        URL.revokeObjectURL(url);
      },
      () => URL.revokeObjectURL(url)
    );
  }
}

function loadBgVideo(file) {
  clearBgVideo();
  const url = URL.createObjectURL(file);

  bgVideo = createVideo(url);
  const el = bgVideo.elt;

  bgVideo.volume(0);
  el.muted = true;
  el.defaultMuted = true;
  el.loop = true;
  el.playsInline = true;
  el.setAttribute("playsinline", "");
  el.setAttribute("webkit-playsinline", "");

  // Keep the element out of view but NOT display:none - mobile WebKit stops
  // decoding frames for display:none <video>, which would leave the canvas
  // showing a frozen/blank background.
  el.style.position = "fixed";
  el.style.width = "1px";
  el.style.height = "1px";
  el.style.opacity = "0";
  el.style.pointerEvents = "none";

  const activate = () => {
    bgImage = null;
    bgMode = "video";
    bgButton.textContent = "BG: VIDEO";
    updateVisibility();
    bgVideo.play().catch(() => {});
  };

  // p5's createVideo callback waits for "canplaythrough", which doesn't
  // reliably fire for blob: URLs on mobile - switch as soon as metadata
  // (and videoWidth/videoHeight) is available instead.
  if (el.readyState >= 1) activate();
  else el.addEventListener("loadedmetadata", activate, { once: true });

  el.addEventListener("loadeddata", () => URL.revokeObjectURL(url), { once: true });
}

function clearBgVideo() {
  if (bgVideo) {
    try { bgVideo.stop(); } catch (e) {}
    try { bgVideo.remove(); } catch (e) {}
  }
  bgVideo = null;
}

// ---- toggles ----
function toggleMode() {
  drawMode = drawMode === "letters" ? "images" : "letters";
  modeButton.textContent = drawMode === "letters" ? "Mode: LETTERS" : "Mode: IMAGES";
  updateVisibility();
}

function toggleEraser() {
  eraser = !eraser;
  eraserButton.textContent = eraser ? "Eraser: ON" : "Eraser: OFF";
  eraserButton.classList.toggle("on", eraser);
  if (cnv) cnv.style("cursor", eraser ? "crosshair" : "default");
}

function toggleAutoLayout() {
  autoLayout = !autoLayout;
  autoButton.textContent = autoLayout ? "Auto-layout: ON" : "Auto-layout: OFF";
  autoButton.classList.toggle("on", autoLayout);

  if (autoLayout) generateAutoLayout();
  else autoCircles = [];

  updateVisibility();
}

function toggleBg() {
  if (bgMode === "color") {
    if (bgVideo) {
      bgMode = "video";
      bgButton.textContent = "BG: VIDEO";
    } else {
      bgMode = "image";
      bgButton.textContent = "BG: IMAGE";
    }
  } else {
    bgMode = "color";
    bgButton.textContent = "BG: COLOR";
  }
  updateVisibility();
}

function toggleOverlay() {
  overlayEnabled = !overlayEnabled;
  overlayButton.textContent = overlayEnabled ? "Overlay: ON" : "Overlay: OFF";
  overlayButton.classList.toggle("on", overlayEnabled);
}

function switchSize(key) {
  if (!SIZES[key]) return;
  currentSize = key;
  relayout();
}

// ---- saving ----
// Mobile: prefer the native share sheet (Save to Photos / Files).
// Desktop: direct download.
async function saveBlob(blob, filename) {
  if (isMobile() && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Triggered by a direct tap, so the gesture is fresh and the mobile share sheet
// can open (share() is called before any await).
function saveLastVideo() {
  if (!lastVideoBlob) return;
  const type = lastVideoType || lastVideoBlob.type || "video/mp4";
  const file = new File([lastVideoBlob], lastVideoName, { type });

  if (navigator.share) {
    try {
      // iOS Safari sometimes reports canShare(files) unreliably. Calling share()
      // directly from this tap is the best path to "Save Video" in Photos.
      navigator.share({ files: [file], title: lastVideoName }).catch((err) => {
        if (err && err.name === "AbortError") return;
        fallbackVideoSave("Share failed.");
      });
      return;
    } catch (e) {
      fallbackVideoSave("Share failed.");
      return;
    }
  }

  fallbackVideoSave("Share sheet unavailable.");
}

function fallbackVideoSave(prefix) {
  if (isIOSLike()) {
    recSetStatus(prefix + " Open this page over HTTPS in Safari, then tap Save Video again.");
    return;
  }
  recSetStatus(prefix + " Downloading video.");
  downloadBlob(lastVideoBlob, lastVideoName);
}

function exportImage() {
  const exportW = canvasW * EXPORT_PIXEL_DENSITY;
  const exportH = canvasH * EXPORT_PIXEL_DENSITY;
  const g = createGraphics(exportW, exportH);

  // The buffer is already created at the final 2x pixel size.
  // Keep p5 density at 1 so the saved PNG is exactly exportW x exportH.
  g.pixelDensity(1);
  g.scale(EXPORT_PIXEL_DENSITY);
  applyGraphicsDefaults(g);
  renderScene(g, canvasW, canvasH);

  const filename = "rundviskom_" + currentSize + ".png";

  g.elt.toBlob((blob) => {
    if (!blob) {
      g.remove();
      return;
    }
    saveBlob(blob, filename);
    g.remove();
  }, "image/png");
}

// ---- video recording ----
function webCodecsAvailable() {
  return (
    typeof window.VideoEncoder === "function" &&
    typeof window.Mp4Muxer !== "undefined"
  );
}

function recSetStatus(msg) {
  if (recStatus) recStatus.textContent = msg || "";
}

async function pickSupportedCodec(baseCfg) {
  const candidates = ["avc1.640034", "avc1.4d4034", "avc1.420034"]; // High/Main/Baseline, level 5.2
  if (!VideoEncoder.isConfigSupported) return candidates[0];
  for (const codec of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({ ...baseCfg, codec });
      if (support && support.supported) return codec;
    } catch (e) {}
  }
  return null;
}

function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

async function startRecording() {
  if (isRecording || !cnv) return;

  const out = SIZES[currentSize].mp4;

  // WebCodecs is exact-size and high-bitrate, but it is brittle on mobile
  // browsers. Mobile uses MediaRecorder on the same exact-size offscreen canvas.
  let ok = false;
  if (webCodecsAvailable() && !isMobile()) {
    ok = await startWebCodecs(out.w, out.h);
    if (ok) recMode = "webcodecs";
  }
  if (!ok) {
    ok = startMediaRecorder(out.w, out.h);
    if (ok) recMode = "mediarecorder";
  }

  if (!ok) {
    cleanupRecGraphics();
    recMode = null;
    recSetStatus("Exact-size video recording isn't supported in this browser.");
    return;
  }

  if (saveVideoButton) saveVideoButton.hidden = true;
  lastVideoBlob = null;
  lastVideoType = "video/mp4";

  recStartTime = performance.now();
  recLastCapture = 0;
  recFrameCount = 0;
  isRecording = true;
  recordButton.textContent = "Stop Recording";
  recordButton.classList.add("recording");
  recSetStatus("Recording " + out.w + "x" + out.h + " [" + recMode + "]");
}

async function startWebCodecs(outW, outH) {
  try {
    recGraphics = createGraphics(outW, outH);
    // WebCodecs is configured for outW x outH. Extra p5 density here creates
    // a larger backing canvas that the browser/encoder must resample.
    recGraphics.pixelDensity(1);
    applyGraphicsDefaults(recGraphics);

    mp4Muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: "avc", width: outW, height: outH },
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });

    const baseCfg = { width: outW, height: outH, bitrate: REC_BITRATE, framerate: REC_FPS };
    const codec = await pickSupportedCodec(baseCfg);
    if (!codec) {
      cleanupRecGraphics();
      mp4Muxer = null;
      return false;
    }

    mp4Encoder = new VideoEncoder({
      output: (chunk, meta) => mp4Muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error("VideoEncoder error:", e),
    });
    mp4Encoder.configure({ ...baseCfg, codec });
    return true;
  } catch (e) {
    console.error("WebCodecs setup failed:", e);
    cleanupRecGraphics();
    mp4Encoder = null;
    mp4Muxer = null;
    return false;
  }
}

function pickRecorderMimeType() {
  const types = [
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
  for (const t of types) if (MediaRecorder.isTypeSupported(t)) return t;
  return "";
}

function startMediaRecorder(outW, outH) {
  if (typeof MediaRecorder === "undefined") return false;

  try {
    recGraphics = createGraphics(outW, outH);
    recGraphics.pixelDensity(1);
    applyGraphicsDefaults(recGraphics);
    renderRecordFrame();

    if (!recGraphics.elt.captureStream) {
      cleanupRecGraphics();
      return false;
    }

    recStream = recGraphics.elt.captureStream(REC_FPS);
    const track = recStream.getVideoTracks && recStream.getVideoTracks()[0];
    const settings = track && track.getSettings ? track.getSettings() : {};
    if (
      (settings.width && settings.width < outW) ||
      (settings.height && settings.height < outH)
    ) {
      throw new Error(
        "Canvas stream is below export size: " +
          (settings.width || "?") + "x" + (settings.height || "?")
      );
    }

    const mimeType = pickRecorderMimeType();
    const opts = { videoBitsPerSecond: REC_BITRATE };
    if (mimeType) opts.mimeType = mimeType;

    mediaRecorder = new MediaRecorder(recStream, opts);
    recordedChunks = [];
    recFinished = false;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = finishMediaRecorder;

    mediaRecorder.start(1000); // emit a chunk every second
    return true;
  } catch (e) {
    console.error("MediaRecorder setup failed:", e);
    if (recStream) {
      recStream.getTracks().forEach((t) => t.stop());
      recStream = null;
    }
    mediaRecorder = null;
    cleanupRecGraphics();
    return false;
  }
}

function renderRecordFrame() {
  if (!recGraphics) return;

  const s = recGraphics.width / canvasW; // uniform (matching aspect ratios)
  recGraphics.push();
  recGraphics.scale(s);
  renderScene(recGraphics, canvasW, canvasH);
  recGraphics.pop();
}

// Render one frame into the exact-size offscreen buffer. WebCodecs gets that
// frame directly; MediaRecorder samples the same canvas stream.
function captureFrameIfRecording() {
  if (!isRecording || !recGraphics) return;

  const elapsed = performance.now() - recStartTime;
  if (elapsed - recLastCapture < 1000 / REC_FPS) return;
  recLastCapture = elapsed;

  renderRecordFrame();

  if (recMode === "mediarecorder") {
    const track = recStream && recStream.getVideoTracks && recStream.getVideoTracks()[0];
    if (track && typeof track.requestFrame === "function") track.requestFrame();
    recFrameCount++;
    return;
  }

  if (recMode !== "webcodecs" || !mp4Encoder) return;

  const frame = new VideoFrame(recGraphics.elt, {
    timestamp: Math.round(elapsed * 1000),
  });
  mp4Encoder.encode(frame, { keyFrame: recFrameCount % REC_FPS === 0 });
  frame.close();
  recFrameCount++;
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  recordButton.textContent = "Record Video";
  recordButton.classList.remove("recording");

  if (recMode === "webcodecs") {
    recSetStatus("Finishing...");
    let blob = null;
    try {
      await Promise.race([
        mp4Encoder.flush(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("flush timeout")), 6000)),
      ]);
      mp4Muxer.finalize();
      blob = new Blob([mp4Muxer.target.buffer], { type: "video/mp4" });
    } catch (e) {
      console.error("Finalizing MP4 failed:", e);
    }
    mp4Encoder = null;
    mp4Muxer = null;
    cleanupRecGraphics();
    finishRecording(blob, "mp4");
  } else if (recMode === "mediarecorder") {
    recSetStatus("Finishing...");
    try { mediaRecorder.requestData(); } catch (e) {}
    try {
      mediaRecorder.stop(); // -> finishMediaRecorder via onstop
    } catch (e) {
      console.error("MediaRecorder stop failed:", e);
      finishMediaRecorder();
      return;
    }
    setTimeout(() => {
      if (!recFinished) finishMediaRecorder();
    }, 2000);
  }
}

function finishMediaRecorder() {
  if (recFinished) return;
  recFinished = true;

  let blob = null;
  let ext = "webm";
  try {
    const type =
      (mediaRecorder && mediaRecorder.mimeType) ||
      (recordedChunks[0] && recordedChunks[0].type) ||
      "video/mp4";
    const base = type.split(";")[0];
    ext = base === "video/mp4" ? "mp4" : "webm";
    if (recordedChunks.length > 0) blob = new Blob(recordedChunks, { type: base });
  } catch (e) {
    console.error("Building video blob failed:", e);
  }

  try {
    if (recStream) {
      recStream.getTracks().forEach((t) => t.stop());
      recStream = null;
    }
  } catch (e) {}
  mediaRecorder = null;
  recordedChunks = [];
  try { cleanupRecGraphics(); } catch (e) {}

  finishRecording(blob, ext);
}

function finishRecording(blob, ext) {
  recMode = null;

  if (!blob || blob.size < 1024) {
    recSetStatus("Recording failed - no frames captured.");
    return;
  }

  lastVideoBlob = blob;
  lastVideoName = "rundviskom_" + currentSize + "." + ext;
  lastVideoType = blob.type || (ext === "mp4" ? "video/mp4" : "video/webm");
  saveVideoButton.hidden = false;

  if (isMobile()) {
    recSetStatus("Ready - tap Save Video.");
  } else {
    recSetStatus("Saved (" + ext.toUpperCase() + ").");
    downloadBlob(blob, lastVideoName);
  }
}

function cleanupRecGraphics() {
  if (recGraphics) {
    recGraphics.remove();
    recGraphics = null;
  }
}

function applyGraphicsDefaults(g) {
  g.textAlign(CENTER, CENTER);
  if (linzFont) g.textFont(linzFont);
  g.imageMode(CENTER);
}

// ---- drawing ----
function draw() {
  background(bgColor);

  push();
  scale(displayScale);
  renderScene(window, canvasW, canvasH);
  pop();

  captureFrameIfRecording();
}

function renderScene(ctx, CW, CH) {
  const isGraphics = ctx !== window;

  const push_ = isGraphics ? () => ctx.push() : () => push();
  const pop_ = isGraphics ? () => ctx.pop() : () => pop();
  const noStroke_ = isGraphics ? () => ctx.noStroke() : () => noStroke();
  const fill_ = isGraphics ? (...a) => ctx.fill(...a) : (...a) => fill(...a);
  const rect_ = isGraphics ? (...a) => ctx.rect(...a) : (...a) => rect(...a);
  const circle_ = isGraphics ? (...a) => ctx.circle(...a) : (...a) => circle(...a);
  const image_ = isGraphics ? (...a) => ctx.image(...a) : (...a) => image(...a);
  const text_ = isGraphics ? (...a) => ctx.text(...a) : (...a) => text(...a);
  const textSize_ = isGraphics ? (s) => ctx.textSize(s) : (s) => textSize(s);
  const textAlign_ = isGraphics ? (h, v) => ctx.textAlign(h, v) : (h, v) => textAlign(h, v);
  const textFont_ = isGraphics ? (f) => ctx.textFont(f) : (f) => textFont(f);
  const imageMode_ = isGraphics ? (m) => ctx.imageMode(m) : (m) => imageMode(m);
  const blendMode_ = isGraphics ? (m) => ctx.blendMode(m) : (m) => blendMode(m);
  const dc = isGraphics ? ctx.drawingContext : drawingContext;

  imageMode_(CENTER);
  textAlign_(CENTER, CENTER);
  if (linzFont) textFont_(linzFont);

  noStroke_();
  fill_(bgColor);
  rect_(0, 0, CW, CH);

  // background media (image or video), cover-scaled and multiplied over base
  let mediaSrc = null;
  let mediaW = 0;
  let mediaH = 0;

  if (bgMode === "image" && bgImage) {
    mediaSrc = bgImage;
    mediaW = bgImage.width;
    mediaH = bgImage.height;
  } else if (bgMode === "video" && bgVideo && bgVideo.elt) {
    mediaW = bgVideo.elt.videoWidth || 0;
    mediaH = bgVideo.elt.videoHeight || 0;
    if (mediaW && mediaH) mediaSrc = bgVideo;
  }

  if (mediaSrc && mediaW && mediaH) {
    const scaleBg = Math.max(CW / mediaW, CH / mediaH);
    push_();
    blendMode_(MULTIPLY);
    image_(mediaSrc, CW / 2, CH / 2, mediaW * scaleBg, mediaH * scaleBg);
    pop_();
  }

  // fixed overlay texture, multiplied on top of the background layer
  if (overlayEnabled && overlayImage && overlayImage.width) {
    const scaleOv = Math.max(CW / overlayImage.width, CH / overlayImage.height);
    push_();
    blendMode_(MULTIPLY);
    image_(overlayImage, CW / 2, CH / 2, overlayImage.width * scaleOv, overlayImage.height * scaleOv);
    pop_();
  }

  // auto-layout shape first (underneath), then manually drawn circles on top
  for (const c of autoCircles.concat(circles)) {
    if (c.img) {
      push_();
      dc.save();
      dc.beginPath();
      dc.arc(c.x, c.y, c.r, 0, TWO_PI);
      dc.clip();

      const d = c.r * 2;
      const scaleImg = Math.max(d / c.img.width, d / c.img.height);
      image_(c.img, c.x, c.y, c.img.width * scaleImg, c.img.height * scaleImg);

      dc.restore();
      pop_();
    } else {
      noStroke_();
      fill_(c.col);
      circle_(c.x, c.y, c.r * 2);

      fill_(0);
      textSize_(c.r * 1.5);
      text_(c.ch, c.x, c.y + 1);
    }
  }
}

function pickPhraseColor() {
  currentCol = PALETTE[phraseCount % PALETTE.length];
}

function updateText() {
  const raw = (textInput.value || "").trim();
  phraseText = (raw.length ? raw : "rundviskom") + "  ";
  letterIndex = 0;
  textJustChanged = true;

  if (autoLayout) {
    pickAutoColor();
    applyLayout();
  }
}

function pickAutoColor() {
  let next;
  do {
    next = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  } while (next === autoCol && PALETTE.length > 1);
  autoCol = next;
}

// ---- auto-layout: place phraseText using one of the saved layouts ----
function generateAutoLayout() {
  if (LAYOUTS.length === 0) return;

  let idx = Math.floor(Math.random() * LAYOUTS.length);
  if (LAYOUTS.length > 1) {
    while (idx === currentLayoutIndex) {
      idx = Math.floor(Math.random() * LAYOUTS.length);
    }
  }

  currentLayoutIndex = idx;
  pickAutoColor();
  applyLayout();
}

function applyLayout() {
  autoCircles = [];
  if (currentLayoutIndex < 0 || currentLayoutIndex >= LAYOUTS.length) return;

  const chars = phraseText.split("");
  if (chars.length === 0) return;

  const layout = LAYOUTS[currentLayoutIndex];
  const pts = layout.pts;
  const scale = (circleR / layout.r) * AUTO_SPACING;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of pts) {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const count = Math.min(chars.length, pts.length);
  for (let i = 0; i < count; i++) {
    const ch = chars[i];
    if (ch === " ") continue;
    autoCircles.push({
      x: canvasW / 2 + (pts[i][0] - cx) * scale,
      y: canvasH / 2 + (pts[i][1] - cy) * scale,
      r: circleR,
      ch,
      col: autoCol,
    });
  }
}

function addCircle(x, y) {
  if (drawMode === "images") {
    if (loadedImages.length === 0) return;
    const img = loadedImages[imgIndex % loadedImages.length];
    circles.push({ x, y, r: circleR, img });
    imgIndex++;
    return;
  }

  if (textJustChanged) {
    phraseCount++;
    pickPhraseColor();
    textJustChanged = false;
  }

  const ch = phraseText[letterIndex];
  if (ch !== " ") {
    circles.push({ x, y, r: circleR, ch, col: currentCol });
  }

  letterIndex++;
  if (letterIndex >= phraseText.length) {
    letterIndex = 0;
    phraseCount++;
    pickPhraseColor();
  }
}

function eraseAt(x, y) {
  circles = circles.filter((c) => dist(x, y, c.x, c.y) > c.r);
  autoCircles = autoCircles.filter((c) => dist(x, y, c.x, c.y) > c.r);
}

function inCanvas() {
  return mouseX >= 0 && mouseY >= 0 && mouseX <= width && mouseY <= height;
}

function pointerToRealCanvas() {
  return { x: mouseX / displayScale, y: mouseY / displayScale };
}

// ---- shared pointer input (mouse + touch) ----
// Each returns true when handled on the canvas (drawing), so the touch wrappers
// know whether to suppress the browser's default behaviour.
function pointerDown() {
  if (!inCanvas()) return false;
  const p = pointerToRealCanvas();
  if (eraser) eraseAt(p.x, p.y);
  else addCircle(p.x, p.y);
  lastX = p.x;
  lastY = p.y;
  return true;
}

function pointerMove() {
  if (!inCanvas()) return false;
  const p = pointerToRealCanvas();

  if (eraser) {
    eraseAt(p.x, p.y);
    return true;
  }

  if (lastX === null) {
    lastX = p.x;
    lastY = p.y;
  }
  const d = dist(p.x, p.y, lastX, lastY);
  if (d >= circleR * DIST_RATIO) {
    addCircle(p.x, p.y);
    lastX = p.x;
    lastY = p.y;
  }
  return true;
}

function pointerUp() {
  lastX = null;
  lastY = null;
}

function mousePressed() { pointerDown(); }
function mouseDragged() { pointerMove(); }
function mouseReleased() { pointerUp(); }

function touchStarted() { return pointerDown() ? false : true; }
function touchMoved() { return pointerMove() ? false : true; }
function touchEnded() { pointerUp(); return true; }

function clearCanvas() {
  circles = [];
  autoCircles = [];
  letterIndex = 0;
  imgIndex = 0;
  phraseCount = 0;
  textJustChanged = false;
  pickPhraseColor();

  if (autoLayout) {
    autoLayout = false;
    if (autoButton) {
      autoButton.textContent = "Auto-layout: OFF";
      autoButton.classList.remove("on");
    }
    updateVisibility();
  }
}

function keyPressed() {
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
  if (key === "c" || key === "C") clearCanvas();
}

function windowResized() {
  relayout();
}
