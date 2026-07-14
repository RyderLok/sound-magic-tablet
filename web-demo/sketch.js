// Minimal p5.js entry point.
// All application state (library, analysis, view switching) lives in app.js.
// This file only manages the p5.js draw loop and wires the modules together.

let canvasInteraction;
let brushGenerator;

function setup() {
  const canvas = createCanvas(1, 1);
  canvas.parent("canvasHolder");
  pixelDensity(1);
  frameRate(60);

  brushGenerator = new BrushGenerator();
  window.brushGenerator = brushGenerator;
  canvasInteraction = new CanvasInteraction(brushGenerator);

  // Wire modules into the App controller.
  App.canvasInteraction = canvasInteraction;
  App.sampleAnalyzer = new SampleAnalyzer();
  App.soundPersonalityAI = new SoundPersonalityAI();
  App.visualMappingEngine = new VisualMappingEngine();

  // Set default canvas state (very calm, nearly blank).
  window.activeVisualParams = App.visualMappingEngine.compute(App.defaultPersonality);
  window.activePersonality = { ...App.defaultPersonality };

  App.init();
}

function draw() {
  if (!canvasInteraction) return;
  if (!window.activeVisualParams) return;

  const fused = VisualPipeline.tick({
    baseParams: window.activeVisualParams,
    personality: window.activePersonality,
    aiResult: window.activeAiResult,
    features: window.activeAudioFeatures
  });

  canvasInteraction.updateAndDraw(
    fused.visualParams,
    fused.personality,
    fused.aiResult
  );
}

function windowResized() {
  const holder = document.getElementById("canvasHolder");
  if (holder && holder.offsetWidth > 10 && holder.offsetHeight > 10) {
    resizeCanvas(holder.offsetWidth, holder.offsetHeight);
    if (canvasInteraction) canvasInteraction.resize();
  }
}

function mouseReleased() {
  if (!canvasInteraction || canvasInteraction.canvasTool !== "draw") return;
  if (canvasInteraction._strokeActive) {
    canvasInteraction.commitStroke();
  }
}

function keyPressed() {
  if (!canvasInteraction) return;
  if (key === "d" || key === "D") {
    App?.setCanvasTool?.("draw");
  } else if (key === "e" || key === "E") {
    App?.setCanvasTool?.("erase");
  }
}
