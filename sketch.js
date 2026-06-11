// rundviskom — generative Instagram-format tool
//
// MP4 recording requires mp4-muxer. Add this to your HTML <head>, before the
// sketch loads:
//   <script src="https://cdn.jsdelivr.net/npm/mp4-muxer"></script>
//
// Layout is responsive: on phones / touch screens the canvas stacks on top
// with the controls below it (page scrolls); on desktop the controls float
// over the centred canvas as before.
//
// Video is exported at the exact sizes below (independent of preview scale):
//   story  -> 1080×1920   post -> 1080×1350,  both at 40 Mbps H.264.

let phraseText = "rundviskom  ";

// new palette
const PALETTE = [
  "#FFE429",
  "#FF1B8A",
  "#FF4B18",
  "#0DB254",
  "#0033C0",
];

const BG_COLORS = [
  "#FFFFFF",
  "#FFE429",
  "#FF1B8A",
  "#FF4B18",
  "#0DB254",
  "#B4B4B4",
];

// ---- canvas sizes: real export/layout coordinates ----
// `mp4` is the exact resolution the video is rendered/encoded at. Each shares
// the layout's aspect ratio, so the scene scales down uniformly (no distortion).
const SIZES = {
  story: { w: 1440, h: 2560, label: "Story (1440×2560)", mp4: { w: 1080, h: 1920 } },
  post: { w: 1152, h: 1440, label: "Post (1152×1440)", mp4: { w: 1080, h: 1350 } },
};

// Pixel density 2 for export
const EXPORT_PIXEL_DENSITY = 2;

// ---- saved "rundviskom" layouts (recreated from the reference artwork) ----
// Letter order: r u n d v i s k o m. Coordinates and radius are stored in
// width-units (px / reference-width) so each blob keeps its proportions;
// the layout is then scaled to fit and centred in the current canvas.
const LAYOUTS = [
  {
    // 1 — diagonal S-stagger (green)
    r: 0.186,
    pts: [
      [0.3701, 0.2287], [0.5668, 0.4284], [0.5035, 0.6603],
      [0.7616, 0.6827], [0.7961, 0.9482], [0.5348, 0.9925],
      [0.2959, 1.1115], [0.2409, 1.347], [0.3757, 1.5794],
      [0.6372, 1.5707],
    ],
  },
  {
    // 2 — loose zig-zag (yellow)
    r: 0.178,
    pts: [
      [0.1461, 0.3506], [0.3439, 0.2178], [0.5515, 0.3687],
      [0.7421, 0.551], [0.6696, 0.8029], [0.4551, 0.9361],
      [0.2774, 1.145], [0.4333, 1.3345], [0.6706, 1.2135],
      [0.8482, 1.3884],
    ],
  },
  {
    // 3 — open question-mark curl (pink)
    r: 0.1748,
    pts: [
      [0.1905, 0.628], [0.2855, 0.4043], [0.4995, 0.2385],
      [0.7228, 0.3759], [0.8052, 0.6235], [0.788, 0.8569],
      [0.6105, 1.0503], [0.3658, 1.1613], [0.2304, 1.3817],
      [0.3399, 1.6005],
    ],
  },
];

// Spreads the circles apart in auto-layout without changing the shape or the
// circle size. 1.0 = the original tight overlap; higher = more gap.
// (~1.43 makes neighbouring circles just touch.)
const AUTO_SPACING = 1.22;

let currentSize = "story";
let canvasW = SIZES[currentSize].w;
let canvasH = SIZES[currentSize].h;

let letterIndex = 0;
let phraseCount = 0;
let currentCol = PALETTE[0];
// set when the text field changes; the next drawn word then steps to the next
// palette colour (consumed in addCircle so typing doesn't burn through colours)
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

// auto-layout: shows one of the saved shapes; manual drawing still works on top
let autoLayout = false;
let currentLayoutIndex = -1;

let loadedImages = [];
let imgIndex = 0;

// background
let bgMode = "image"; // "color" | "image" | "video"
let bgColor = "#FFFFFF";
let bgImage = null;
let bgVideo = null;

// canvas + preview scaling + layout containers
let cnv;
let appRoot;
let canvasHolder;
let layoutMobile = false;
let displayScale = 1;
let previewW = 1;
let previewH = 1;

// UI elements
let panel;
let textInput;
let modeButton, eraserButton;
let autoButton, regenButton;
let imgFileInput, bgButton, bgFileInput, bgColorSelect;
let sizeSelect, exportButton;
let recordButton, saveVideoButton, clearButton;

// ---- video recording (WebCodecs -> MP4) ----
let isRecording = false;
let mp4Muxer = null;
let mp4Encoder = null;
let recGraphics = null;
let recStartTime = 0;
let recFrameCount = 0;
let recLastCapture = 0;
const REC_FPS = 30;
const REC_BITRATE = 40_000_000; // 40 Mbps

// last finished recording, held so a fresh user tap can save it on mobile
let lastVideoBlob = null;
let lastVideoName = "";

function preload() {
  linzFont = loadFont("LinzSans-Medium.ttf");

  // default background image; falls back to the colour background if missing
  bgImage = loadImage(
    "/background-image.png",
    () => {},
    () => {
      bgImage = null;
      bgMode = "color";
    }
  );
}

function setup() {
  injectStyles();

  appRoot = createDiv();
  appRoot.id("rvk-root");

  canvasHolder = createDiv();
  canvasHolder.id("rvk-canvas-holder");
  canvasHolder.parent(appRoot);

  pixelDensity(2);
  recalcDisplayScale();

  cnv = createCanvas(previewW, previewH);
  cnv.parent(canvasHolder);
  cnv.style("display", "block");
  cnv.style("position", "static");
  cnv.style("background", "#fff");
  cnv.style("touch-action", "none"); // canvas handles touch; page scrolls elsewhere
  cnv.style("user-select", "none");
  cnv.style("-webkit-user-select", "none");

  applyCtxDefaults();
  pickPhraseColor();
  buildUI();
  applyLayoutMode();
}

function injectStyles() {
  const css = `
    html, body { margin: 0; background: #dcdcdc; }
    @media (pointer: coarse), (max-width: 820px) {
      #rvk-panel { font-size: 14px !important; }
      #rvk-panel button,
      #rvk-panel input,
      #rvk-panel select {
        font-size: 16px !important;   /* >=16px stops iOS zooming on focus */
        padding: 11px 12px !important;
      }
    }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

function isMobile() {
  return window.matchMedia("(pointer: coarse), (max-width: 820px)").matches;
}

function applyCtxDefaults() {
  textAlign(CENTER, CENTER);
  if (linzFont) textFont(linzFont);
  imageMode(CENTER);
}

function recalcDisplayScale() {
  canvasW = SIZES[currentSize].w;
  canvasH = SIZES[currentSize].h;

  const mobile = isMobile();
  const margin = mobile ? 12 : 20;
  const availW = Math.max(1, window.innerWidth - margin * 2);

  // Mobile: the page scrolls, so cap the canvas height so the controls below
  // stay reachable. Desktop: fit the full window (the panel floats on top).
  const availH = mobile
    ? Math.max(1, Math.round(window.innerHeight * 0.62))
    : Math.max(1, window.innerHeight - margin * 2);

  displayScale = Math.min(availW / canvasW, availH / canvasH, 1);

  previewW = Math.max(1, Math.round(canvasW * displayScale));
  previewH = Math.max(1, Math.round(canvasH * displayScale));
}

function applyLayoutMode() {
  if (!panel || !canvasHolder || !appRoot) return;

  layoutMobile = isMobile();

  if (layoutMobile) {
    document.body.style.overflowX = "hidden";
    document.body.style.overflowY = "auto";

    appRoot.style("display", "flex");
    appRoot.style("flex-direction", "column");
    appRoot.style("align-items", "center");
    appRoot.style("gap", "14px");
    appRoot.style("padding", "12px");
    appRoot.style("box-sizing", "border-box");
    appRoot.style("width", "100%");
    appRoot.style("min-height", "100vh");
    appRoot.style("position", "static");

    canvasHolder.style("position", "static");
    canvasHolder.style("width", "100%");
    canvasHolder.style("display", "flex");
    canvasHolder.style("justify-content", "center");
    canvasHolder.style("align-items", "flex-start");

    panel.style("position", "static");
    panel.style("top", "auto");
    panel.style("left", "auto");
    panel.style("width", previewW + "px");
    panel.style("max-width", "100%");
    panel.style("z-index", "auto");
  } else {
    document.body.style.overflow = "hidden";

    appRoot.style("display", "block");
    appRoot.style("position", "static");
    appRoot.style("padding", "0");
    appRoot.style("min-height", "auto");

    // canvas centred in the viewport
    canvasHolder.style("position", "fixed");
    canvasHolder.style("top", "0");
    canvasHolder.style("left", "0");
    canvasHolder.style("right", "0");
    canvasHolder.style("bottom", "0");
    canvasHolder.style("width", "auto");
    canvasHolder.style("display", "flex");
    canvasHolder.style("align-items", "center");
    canvasHolder.style("justify-content", "center");

    // floating control panel
    panel.style("position", "fixed");
    panel.style("top", "16px");
    panel.style("left", "16px");
    panel.style("width", "210px");
    panel.style("max-width", "none");
    panel.style("z-index", "10");
  }
}

function relayout() {
  if (!cnv) return;

  recalcDisplayScale();
  resizeCanvas(previewW, previewH);
  applyCtxDefaults();
  applyLayoutMode();

  // re-centre the current auto-layout for the new size / orientation
  if (autoLayout) applyLayout();
}

function buildUI() {
  panel = createDiv();
  panel.id("rvk-panel");
  panel.parent(appRoot);
  panel.style("box-sizing", "border-box");
  panel.style("padding", "12px 14px");
  panel.style("background", "rgba(255,255,255,0.92)");
  panel.style("backdrop-filter", "blur(4px)");
  panel.style("border", "1px solid rgba(0,0,0,0.08)");
  panel.style("border-radius", "12px");
  panel.style("box-shadow", "0 6px 20px rgba(0,0,0,0.12)");
  panel.style("font-family", "system-ui, sans-serif");
  panel.style("font-size", "12px");
  panel.style("color", "#1a1a1a");

  uiLabel("Text");
  textInput = createInput("rundviskom");
  textInput.parent(panel);
  styleBlock(textInput);
  textInput.style("width", "100%");
  textInput.style("box-sizing", "border-box");
  textInput.style("padding", "7px 10px");
  textInput.style("border", "1px solid rgba(0,0,0,0.15)");
  textInput.style("border-radius", "8px");
  textInput.style("font-size", "12px");
  textInput.input(updateText);

  uiLabel("Draw mode");
  modeButton = createButton("Mode: LETTERS");
  modeButton.parent(panel);
  styleButton(modeButton);
  modeButton.mousePressed(toggleMode);

  eraserButton = createButton("Eraser: OFF");
  eraserButton.parent(panel);
  styleButton(eraserButton);
  eraserButton.style("margin-top", "6px");
  eraserButton.mousePressed(toggleEraser);

  uiLabel("Images");
  imgFileInput = createFileInput(() => {}, true);
  imgFileInput.parent(panel);
  styleBlock(imgFileInput);
  imgFileInput.elt.addEventListener("change", loadSelectedImages);

  uiLabel("Auto-layout");
  autoButton = createButton("Auto-layout: OFF");
  autoButton.parent(panel);
  styleButton(autoButton);
  autoButton.mousePressed(toggleAutoLayout);

  regenButton = createButton("↻  New random curve");
  regenButton.parent(panel);
  styleButton(regenButton);
  regenButton.style("margin-top", "6px");
  regenButton.mousePressed(generateAutoLayout);

  uiLabel("Background color");
  bgColorSelect = createSelect();
  bgColorSelect.parent(panel);
  styleBlock(bgColorSelect);
  bgColorSelect.style("width", "100%");

  BG_COLORS.forEach((c) => {
    bgColorSelect.option(c, c);
  });

  bgColorSelect.selected(bgColor);
  bgColorSelect.changed(() => {
    bgColor = bgColorSelect.value();
    bgMode = "color";
    bgButton.html("BG: COLOR");
    updateVisibility();
  });

  uiLabel("Background image / video");
  bgButton = createButton(bgMode === "image" ? "BG: IMAGE" : "BG: COLOR");
  bgButton.parent(panel);
  styleButton(bgButton);
  bgButton.mousePressed(toggleBg);

  bgFileInput = createFileInput(() => {}, false);
  bgFileInput.parent(panel);
  styleBlock(bgFileInput);
  bgFileInput.elt.setAttribute("accept", "image/*,video/*");
  bgFileInput.elt.addEventListener("change", handleBgFile);

  uiLabel("Canvas size");
  sizeSelect = createSelect();
  sizeSelect.parent(panel);
  styleBlock(sizeSelect);
  sizeSelect.style("width", "100%");

  for (const key in SIZES) {
    sizeSelect.option(SIZES[key].label, key);
  }

  sizeSelect.selected(currentSize);
  sizeSelect.changed(() => switchSize(sizeSelect.value()));

  uiLabel("");
  exportButton = createButton("⬇  Export PNG");
  exportButton.parent(panel);
  styleButton(exportButton);
  exportButton.style("background", "#1a1a1a");
  exportButton.style("color", "#fff");
  exportButton.style("border-color", "#1a1a1a");
  exportButton.mousePressed(exportImage);

  uiLabel("");
  recordButton = createButton("⏺  Record video");
  recordButton.parent(panel);
  styleButton(recordButton);
  recordButton.mousePressed(toggleRecording);

  // Shown after a mobile recording finishes; tapping it (a fresh user gesture)
  // opens the share/save sheet, which an awaited flush() can't do on its own.
  saveVideoButton = createButton("⬇  Save video");
  saveVideoButton.parent(panel);
  styleButton(saveVideoButton);
  saveVideoButton.style("margin-top", "6px");
  saveVideoButton.style("background", "#0DB254");
  saveVideoButton.style("color", "#fff");
  saveVideoButton.style("border-color", "#0DB254");
  saveVideoButton.mousePressed(saveLastVideo);
  saveVideoButton.hide();

  uiLabel("");
  clearButton = createButton("✕  Clear canvas");
  clearButton.parent(panel);
  styleButton(clearButton);
  clearButton.mousePressed(clearCanvas);

  updateVisibility();
}

// ---- small UI styling helpers ----
function uiLabel(txt) {
  const l = createDiv(txt);
  l.parent(panel);
  l.style("margin", txt ? "12px 0 5px" : "14px 0 0");
  l.style("font-weight", "600");
  l.style("letter-spacing", "0.02em");
  return l;
}

function styleBlock(el) {
  el.style("display", "block");
  el.style("margin", "0");
}

function styleButton(b) {
  b.style("display", "block");
  b.style("width", "100%");
  b.style("padding", "7px 10px");
  b.style("margin", "0");
  b.style("border", "1px solid rgba(0,0,0,0.15)");
  b.style("border-radius", "8px");
  b.style("background", "#f4f4f4");
  b.style("font-size", "12px");
  b.style("cursor", "pointer");
}

function updateVisibility() {
  // image picker is shown whenever the LETTERS/IMAGES toggle is on IMAGES
  if (drawMode === "images") imgFileInput.show();
  else imgFileInput.hide();

  // media picker is shown for image or video backgrounds
  if (bgMode === "image" || bgMode === "video") bgFileInput.show();
  else bgFileInput.hide();

  // "new random curve" only matters while auto-layout is on
  if (autoLayout) regenButton.show();
  else regenButton.hide();
}

// ---- file handlers ----
function loadSelectedImages() {
  const files = Array.from(imgFileInput.elt.files || []);

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
      () => {
        URL.revokeObjectURL(url);
      }
    );
  });
}

function handleBgFile() {
  const file = bgFileInput.elt.files && bgFileInput.elt.files[0];
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
        bgButton.html("BG: IMAGE");
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

  // hidden, muted, looping video used purely as a background texture
  bgVideo = createVideo(url, () => {
    bgVideo.hide();
    bgVideo.volume(0);
    bgVideo.elt.muted = true;
    bgVideo.elt.playsInline = true;
    bgVideo.elt.setAttribute("playsinline", "");
    bgVideo.elt.setAttribute("webkit-playsinline", "");
    bgVideo.loop();
    bgVideo.play().catch(() => {});

    bgImage = null;
    bgMode = "video";
    bgButton.html("BG: VIDEO");
    updateVisibility();
  });
}

function clearBgVideo() {
  if (bgVideo) {
    try {
      bgVideo.stop();
    } catch (e) {}
    try {
      bgVideo.remove();
    } catch (e) {}
  }
  bgVideo = null;
}

// ---- toggles ----
function toggleMode() {
  drawMode = drawMode === "letters" ? "images" : "letters";
  modeButton.html(drawMode === "letters" ? "Mode: LETTERS" : "Mode: IMAGES");
  updateVisibility();
}

function toggleEraser() {
  eraser = !eraser;
  eraserButton.html(eraser ? "Eraser: ON" : "Eraser: OFF");
  eraserButton.style("background", eraser ? "#ffe0e0" : "#f4f4f4");
  if (cnv) cnv.style("cursor", eraser ? "crosshair" : "default");
}

function toggleAutoLayout() {
  autoLayout = !autoLayout;
  autoButton.html(autoLayout ? "Auto-layout: ON" : "Auto-layout: OFF");

  // turning it on lays out a shape; turning it off removes the shape but keeps
  // any circles you've drawn on top
  if (autoLayout) generateAutoLayout();
  else autoCircles = [];

  updateVisibility();
}

function toggleBg() {
  if (bgMode === "color") {
    // switch to whatever media is loaded (prefer video); otherwise reveal picker
    if (bgVideo) {
      bgMode = "video";
      bgButton.html("BG: VIDEO");
    } else {
      bgMode = "image";
      bgButton.html("BG: IMAGE");
    }
  } else {
    bgMode = "color";
    bgButton.html("BG: COLOR");
  }

  updateVisibility();
}

function switchSize(key) {
  if (!SIZES[key]) return;

  currentSize = key;
  relayout();
}

// ---- saving ----
// Mobile: prefer the native share sheet so the file can go to Photos / Files.
// Desktop: always use the original direct download (more reliable there).
async function saveBlob(blob, filename) {
  if (isMobile() && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return; // user dismissed the sheet
      // any other error (e.g. lost user-gesture): fall through to download
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

// Triggered by a direct button tap, so the gesture is fresh and the mobile
// share sheet can open (saveBlob calls navigator.share before any await).
function saveLastVideo() {
  if (!lastVideoBlob) return;
  saveBlob(lastVideoBlob, lastVideoName);
}

function exportImage() {
  const exportW = canvasW * EXPORT_PIXEL_DENSITY;
  const exportH = canvasH * EXPORT_PIXEL_DENSITY;
  const g = createGraphics(exportW, exportH);

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

// ---- video recording (WebCodecs -> MP4) ----
function webCodecsAvailable() {
  return (
    typeof window.VideoEncoder === "function" &&
    typeof window.Mp4Muxer !== "undefined"
  );
}

async function pickSupportedCodec(baseCfg) {
  // High / Main / Baseline, all at level 5.2 so 1080×1920 @ 40 Mbps fits.
  const candidates = ["avc1.640034", "avc1.4d4034", "avc1.420034"];
  if (!VideoEncoder.isConfigSupported) return candidates[0];
  for (const codec of candidates) {
    const support = await VideoEncoder.isConfigSupported({ ...baseCfg, codec });
    if (support && support.supported) return codec;
  }
  return null;
}

function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

async function startRecording() {
  if (isRecording || !cnv) return;

  if (!webCodecsAvailable()) {
    console.warn(
      "MP4 recording needs WebCodecs + mp4-muxer. Add " +
        '<script src="https://cdn.jsdelivr.net/npm/mp4-muxer"></script> ' +
        "to the page and use a current Chrome/Edge/Firefox or Safari 16.4+."
    );
    return;
  }

  // Exact output size for the current format (independent of the preview).
  const out = SIZES[currentSize].mp4;
  const outW = out.w;
  const outH = out.h;

  // Offscreen buffer we render each frame into at the real export size.
  recGraphics = createGraphics(outW, outH);
  recGraphics.pixelDensity(1);
  applyGraphicsDefaults(recGraphics);

  mp4Muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: outW, height: outH },
    fastStart: "in-memory",
    // capture starts a fraction of a second after performance.now()'s origin,
    // so the first frame's timestamp isn't 0; this offsets the track to 0.
    firstTimestampBehavior: "offset",
  });

  const baseCfg = {
    width: outW,
    height: outH,
    bitrate: REC_BITRATE,
    framerate: REC_FPS,
  };

  const codec = await pickSupportedCodec(baseCfg);
  if (!codec) {
    console.warn("No supported H.264 encoder config for this size/bitrate.");
    recGraphics.remove();
    recGraphics = null;
    mp4Muxer = null;
    return;
  }

  mp4Encoder = new VideoEncoder({
    output: (chunk, meta) => mp4Muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("VideoEncoder error:", e),
  });
  mp4Encoder.configure({ ...baseCfg, codec });

  // starting fresh: drop any previously stashed clip + its Save button
  if (saveVideoButton) saveVideoButton.hide();
  lastVideoBlob = null;

  recStartTime = performance.now();
  recLastCapture = 0;
  recFrameCount = 0;
  isRecording = true;
  recordButton.html("⏹  Stop recording");
}

// Render one frame into the offscreen buffer at full export resolution, then
// hand it to the encoder. Called at the end of draw().
function captureFrameIfRecording() {
  if (!isRecording || !mp4Encoder || !recGraphics) return;

  const elapsed = performance.now() - recStartTime;

  // throttle to REC_FPS so a 60fps draw loop doesn't double the encode work
  if (elapsed - recLastCapture < 1000 / REC_FPS) return;
  recLastCapture = elapsed;

  // Map the logical canvasW×canvasH layout onto the output buffer (uniform,
  // since the format and the mp4 size share the same aspect ratio).
  const s = recGraphics.width / canvasW; // == recGraphics.height / canvasH

  recGraphics.push();
  recGraphics.scale(s);
  renderScene(recGraphics, canvasW, canvasH);
  recGraphics.pop();

  const frame = new VideoFrame(recGraphics.elt, {
    timestamp: Math.round(elapsed * 1000), // microseconds
  });

  // keyframe roughly once per second
  mp4Encoder.encode(frame, { keyFrame: recFrameCount % REC_FPS === 0 });
  frame.close();
  recFrameCount++;
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  recordButton.html("⏺  Record video");

  if (!mp4Encoder) return;

  await mp4Encoder.flush();
  mp4Muxer.finalize();

  const { buffer } = mp4Muxer.target;
  const blob = new Blob([buffer], { type: "video/mp4" });

  const name = "rundviskom_" + currentSize + ".mp4";

  if (isMobile()) {
    // navigator.share needs a live user gesture, but the awaited flush() above
    // consumed it — so stash the file and let a button tap trigger the share.
    lastVideoBlob = blob;
    lastVideoName = name;
    saveVideoButton.show();
  } else {
    // desktop download works without a gesture
    downloadBlob(blob, name);
  }

  mp4Encoder = null;
  mp4Muxer = null;
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

  // Full background base, always using the real format size.
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

      image_(
        c.img,
        c.x,
        c.y,
        c.img.width * scaleImg,
        c.img.height * scaleImg
      );

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
  // step to the next palette colour each time the word "rundviskom" restarts
  currentCol = PALETTE[phraseCount % PALETTE.length];
}

function updateText() {
  const raw = (textInput.value() || "").trim();
  // fall back to the default word when empty; the two trailing spaces
  // preserve the gap + colour-step between repeats when drawing
  phraseText = (raw.length ? raw : "rundviskom") + "  ";

  // start the next drawn letter at the beginning of the new word
  letterIndex = 0;

  // the new word should get the next palette colour; we apply it on the next
  // draw (not here) so typing several letters doesn't cycle the whole palette
  textJustChanged = true;

  // refresh the shape live if auto-layout is on, giving it a fresh colour too
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
// generateAutoLayout() picks a new random blob (avoiding an immediate repeat)
// and a fresh colour. applyLayout() draws the current blob using the radius
// from the slider, so every shape uses the same circle size and the radius
// control resizes the layout live.
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

  // Circle radius stays at circleR; positions are spread by AUTO_SPACING so a
  // larger value reduces the overlap between neighbouring circles.
  const scale = (circleR / layout.r) * AUTO_SPACING;

  // centre of the point cloud (radius is uniform, so this centres the shape)
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

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

    circles.push({
      x,
      y,
      r: circleR,
      img,
    });

    imgIndex++;
    return;
  }

  // a freshly entered word steps to the next palette colour
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

// ---- eraser ----
function eraseAt(x, y) {
  // remove any circle (drawn or auto-layout) the cursor is inside
  circles = circles.filter((c) => dist(x, y, c.x, c.y) > c.r);
  autoCircles = autoCircles.filter((c) => dist(x, y, c.x, c.y) > c.r);
}

// ---- pointer helpers ----
function overUI() {
  if (!panel) return false;

  const r = panel.elt.getBoundingClientRect();

  return (
    winMouseX >= r.left &&
    winMouseX <= r.right &&
    winMouseY >= r.top &&
    winMouseY <= r.bottom
  );
}

function inCanvas() {
  return mouseX >= 0 && mouseY >= 0 && mouseX <= width && mouseY <= height;
}

function pointerToRealCanvas() {
  return {
    x: mouseX / displayScale,
    y: mouseY / displayScale,
  };
}

// ---- shared pointer input (mouse + touch) ----
// Each returns true when the gesture was handled on the canvas (drawing), so
// the touch wrappers know whether to suppress the browser's default behaviour.
function pointerDown() {
  if (overUI() || !inCanvas()) return false;

  const p = pointerToRealCanvas();

  if (eraser) {
    eraseAt(p.x, p.y);
  } else {
    addCircle(p.x, p.y);
  }

  lastX = p.x;
  lastY = p.y;
  return true;
}

function pointerMove() {
  if (overUI() || !inCanvas()) return false;

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

function mousePressed() {
  pointerDown();
}

function mouseDragged() {
  pointerMove();
}

function mouseReleased() {
  pointerUp();
}

// Returning false on a canvas touch suppresses the synthesized mouse events
// (no double-drawing) and the default gesture. Over the controls / outside the
// canvas we return true, so buttons and page scrolling keep working.
function touchStarted() {
  return pointerDown() ? false : true;
}

function touchMoved() {
  return pointerMove() ? false : true;
}

function touchEnded() {
  pointerUp();
  return true;
}

function clearCanvas() {
  circles = [];
  autoCircles = [];
  letterIndex = 0;
  imgIndex = 0;
  phraseCount = 0;
  textJustChanged = false;
  pickPhraseColor();

  // clearing also returns to manual drawing
  if (autoLayout) {
    autoLayout = false;
    if (autoButton) autoButton.html("Auto-layout: OFF");
    updateVisibility();
  }
}

function keyPressed() {
  // ignore shortcuts while typing in the text field
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;

  if (key === "c" || key === "C") clearCanvas();
}

function windowResized() {
  relayout();
}
