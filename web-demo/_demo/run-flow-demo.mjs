#!/usr/bin/env node
/**
 * TEMPORARY demo launcher — does NOT modify product source.
 * Injects up to 5 real local WAVs into New Sounds and forces 5 brush styles
 * (runtime-only after Transform) so the demo shows distinct patterns + colors.
 *
 * Delete this whole web-demo/_demo/ folder anytime.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, 'python-service', 'output');
const APP = process.env.PIKO_URL || 'http://127.0.0.1:8000';
const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** One real file per brush family when available */
const CANDIDATES = [
  'Morning birds.wav',
  'Wind leaves.wav',
  'Water drip.wav',
  'Pebble tap.wav',
  'sound14.wav',
  'Field sound 5.wav',
  'omni_test.wav',
  'piko_demo_test.wav'
];

/** 5 product stroke patterns + vivid palettes (demo stamp only) */
const STYLE_PRESETS = [
  {
    label: 'Birds · Scatter Points',
    archetype: 'birds',
    pattern: 'scatter_points',
    palette: [
      { r: 254, g: 120, b: 48 },
      { r: 255, g: 186, b: 64 },
      { r: 240, g: 70, b: 60 }
    ]
  },
  {
    label: 'Wind · Flow Field',
    archetype: 'wind_leaves',
    pattern: 'flow_field',
    palette: [
      { r: 96, g: 170, b: 140 },
      { r: 60, g: 130, b: 120 },
      { r: 180, g: 210, b: 170 }
    ]
  },
  {
    label: 'Water · Wave Ripple',
    archetype: 'water',
    pattern: 'wave_ripple',
    palette: [
      { r: 46, g: 132, b: 254 },
      { r: 72, g: 214, b: 246 },
      { r: 30, g: 90, b: 200 }
    ]
  },
  {
    label: 'Impact · Impact Burst',
    archetype: 'material_impact',
    pattern: 'impact_burst',
    palette: [
      { r: 200, g: 110, b: 60 },
      { r: 150, g: 80, b: 40 },
      { r: 240, g: 170, b: 90 }
    ]
  },
  {
    label: 'Insects · Pulse Grid',
    archetype: 'insects_amphibians',
    pattern: 'pulse_grid',
    palette: [
      { r: 80, g: 190, b: 70 },
      { r: 40, g: 140, b: 60 },
      { r: 180, g: 230, b: 90 }
    ]
  }
];

function pickWavs(max = 5) {
  const found = [];
  for (const name of CANDIDATES) {
    const p = path.join(OUT_DIR, name);
    if (fs.existsSync(p) && fs.statSync(p).size > 8000) found.push(p);
    if (found.length >= max) break;
  }
  return found;
}

function isAudibleWav(filePath) {
  const buf = fs.readFileSync(filePath);
  let dataAt = -1;
  for (let i = 12; i < Math.min(buf.length - 8, 200); i++) {
    if (buf.toString('ascii', i, i + 4) === 'data') {
      dataAt = i + 8;
      break;
    }
  }
  if (dataAt < 0) dataAt = 44;
  const pcm = buf.subarray(dataAt);
  if (pcm.length < 2000) return false;
  let peak = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    let v = pcm[i] | (pcm[i + 1] << 8);
    if (v >= 0x8000) v -= 0x10000;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += a;
    n += 1;
    if (n > 80000) break;
  }
  return peak > 2000 && sum / Math.max(1, n) > 200;
}

async function main() {
  const wavs = pickWavs(5).filter(isAudibleWav);
  if (!wavs.length) {
    console.error('No audible WAV found in', OUT_DIR);
    process.exit(1);
  }

  console.log('Piko demo flow — 5 brush styles (temporary, no product source edits)');
  console.log('App:', APP);
  wavs.forEach((p, i) => {
    const style = STYLE_PRESETS[i % STYLE_PRESETS.length];
    console.log(
      ` ${i + 1}. ${path.basename(p)} → ${style.pattern} (${style.label})`
    );
  });

  const payloads = wavs.map((p, i) => ({
    name: path.basename(p, '.wav'),
    fileName: path.basename(p),
    b64: fs.readFileSync(p).toString('base64'),
    bytes: fs.statSync(p).size,
    styleIndex: i % STYLE_PRESETS.length,
    style: STYLE_PRESETS[i % STYLE_PRESETS.length]
  }));

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    defaultViewport: null,
    args: [
      '--window-size=1280,900',
      '--autoplay-policy=no-user-gesture-required',
      '--new-window'
    ]
  });

  const page = (await browser.pages())[0] || (await browser.newPage());
  page.setDefaultTimeout(60000);
  await page.goto(APP + '/?demoFlow=1&v=' + Date.now(), { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => window.App && window.SoundsApiClient && window.PikoRouter && window.PlateManager,
    { timeout: 25000 }
  );

  // Runtime safety patch for preview ink index + demo style stamp after Transform
  await page.evaluate((presets) => {
    try {
      const proto = window.BrushGenerator && window.BrushGenerator.prototype;
      if (proto && typeof proto.inkIndexFromAudio === 'function') {
        proto.inkIndexFromAudio = function (paletteLen) {
          const t = (this.smoothed && (this.smoothed.high || this.smoothed.treble)) || 0;
          const m = (this.smoothed && this.smoothed.mid) || 0;
          const l = (this.smoothed && this.smoothed.low) || 0;
          const mix = Math.min(1, Math.max(0, t * 0.45 + m * 0.35 + l * 0.2));
          const n = Math.max(1, paletteLen | 0);
          return Math.min(n - 1, Math.floor(mix * n));
        };
      }
    } catch (_) {}

    window.__PIKO_DEMO_STYLES__ = presets;

    function stampDemoStyle(sample) {
      if (!sample || sample.demoStyleIndex == null) return sample;
      const style = window.__PIKO_DEMO_STYLES__[sample.demoStyleIndex];
      if (!style) return sample;
      const vp = Object.assign({}, sample.visualParams || {});
      vp.strokePattern = style.pattern;
      vp.archetypeId = style.archetype;
      vp.motionModel = 'organic';
      vp.palette = style.palette.map((c) => ({ r: c.r, g: c.g, b: c.b }));
      sample.visualParams = vp;
      sample.pythonSemantic = Object.assign({}, sample.pythonSemantic || {}, {
        archetype: style.archetype,
        soundLabel: style.label.split(' · ')[0],
        confidence: Math.max(0.86, Number(sample.pythonSemantic && sample.pythonSemantic.confidence) || 0.9),
        description: 'Demo stamp: force distinct brush family for walkthrough'
      });
      if (!sample.aiResult) sample.aiResult = {};
      if (!sample.aiResult.identity) sample.aiResult.identity = {};
      sample.aiResult.identity.name = style.label;
      sample.name = style.label;
      sample.status = 'analyzed';
      return sample;
    }
    window.__pikoStampDemoStyle = stampDemoStyle;

    // Wrap Transform so after real analysis we still show 5 distinct brushes
    function wrapHeadless() {
      const tv = window.App && window.App.transformView;
      if (!tv || typeof tv.runHeadless !== 'function' || tv.runHeadless.__demoStyled) return false;
      const orig = tv.runHeadless.bind(tv);
      const wrapped = async function (sample, opts) {
        const result = await orig(sample, opts);
        stampDemoStyle(sample);
        return result;
      };
      wrapped.__demoStyled = true;
      tv.runHeadless = wrapped;
      return true;
    }
    if (!wrapHeadless()) {
      let tries = 0;
      const t = setInterval(() => {
        if (wrapHeadless() || ++tries > 50) clearInterval(t);
      }, 100);
    }
  }, STYLE_PRESETS);

  // Session-only: no IndexedDB; keep ephemeral across sync
  await page.evaluate(() => {
    const a = window.App;
    a.persistSample = function () {};
    if (window.SampleLibraryStore) {
      window.SampleLibraryStore.saveSample = () => Promise.resolve();
      window.SampleLibraryStore.appendAnalysisHistory = () => Promise.resolve();
    }
    const client = window.SoundsApiClient;
    if (client && !client.__demoWrappedSync) {
      const orig = client.syncIntoApp.bind(client);
      client.syncIntoApp = async function (app) {
        const keep = (app.soundLibrary || []).filter((s) => s && s.ephemeral);
        const res = await orig(app);
        keep.forEach((s) => {
          if (!app.soundLibrary.some((x) => x && x.id === s.id)) app.soundLibrary.unshift(s);
        });
        return res;
      };
      client.__demoWrappedSync = true;
    }
  });

  await page.evaluate(() => {
    window.PikoRouter.show('collect', { mode: 'fade' });
  });
  await new Promise((r) => setTimeout(r, 1000));

  const result = await page.evaluate(async (payloads) => {
    const a = window.App;
    const client = window.SoundsApiClient;

    function b64ToBlob(b64) {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: 'audio/wav' });
    }

    async function decodeMeta(blob) {
      const ab = await blob.arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      let buf;
      try {
        buf = await ctx.decodeAudioData(ab.slice(0));
      } finally {
        try {
          await ctx.close();
        } catch (_) {}
      }
      const ch = buf.getChannelData(0);
      let sum = 0;
      let peak = 0;
      let active = 0;
      for (let i = 0; i < ch.length; i++) {
        const v = Math.abs(ch[i]);
        sum += v * v;
        if (v > peak) peak = v;
        if (v > 0.01) active += 1;
      }
      const wave = new Float32Array(200);
      for (let i = 0; i < 200; i++) {
        wave[i] = ch[Math.floor((i * ch.length) / 200)] || 0;
      }
      return {
        duration: buf.duration,
        rms: Math.sqrt(sum / ch.length),
        peak,
        activeRatio: active / ch.length,
        waveformSnapshot: wave
      };
    }

    if (typeof client.beginTransferSession === 'function') client.beginTransferSession();
    if (window.PlateManager && window.PlateManager.clear) window.PlateManager.clear();

    a.soundLibrary = (a.soundLibrary || []).filter(
      (s) => !(s && String(s.id || '').startsWith('demo-live-'))
    );

    const ids = [];
    const reports = [];
    for (let i = 0; i < payloads.length; i++) {
      const p = payloads[i];
      const blob = b64ToBlob(p.b64);
      const meta = await decodeMeta(blob);
      if (!(meta.rms > 0.02 && meta.activeRatio > 0.05 && meta.duration > 0.3)) {
        reports.push({ name: p.name, audible: false });
        continue;
      }
      const id = 'demo-live-' + p.styleIndex + '-' + Date.now();
      ids.push(id);
      const style = p.style;
      const sample = {
        id,
        name: style.label,
        fileName: p.fileName,
        file: new File([blob], p.fileName, { type: 'audio/wav' }),
        duration: meta.duration,
        waveformSnapshot: meta.waveformSnapshot,
        features: { energy: 0.45 + p.styleIndex * 0.08, volume: 0.5 },
        aiResult: { identity: { name: style.label } },
        visualParams: {
          strokePattern: style.pattern,
          archetypeId: style.archetype,
          motionModel: 'organic',
          palette: style.palette.map((c) => ({ r: c.r, g: c.g, b: c.b }))
        },
        pythonSemantic: {
          archetype: style.archetype,
          soundLabel: style.label.split(' · ')[0],
          confidence: 0.92
        },
        acoustic: null,
        shapeProfile: null,
        status: 'ready',
        source: 'demo-temp',
        ephemeral: true,
        skipPersist: true,
        demoStyleIndex: p.styleIndex,
        analysisHistory: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      a.soundLibrary.unshift(sample);
      reports.push({
        name: style.label,
        file: p.fileName,
        pattern: style.pattern,
        audible: true,
        duration: +meta.duration.toFixed(2),
        rms: +meta.rms.toFixed(4)
      });
    }

    client.setLatestBatch(ids);
    window.PikoRouter.show('sounds', { mode: 'fade' });
    await new Promise((r) => setTimeout(r, 600));
    client.setLatestBatch(ids);
    if (window.PikoSoundsScreen && window.PikoSoundsScreen.render) {
      window.PikoSoundsScreen.render();
    }

    const latest = (client.listLatestSamples && client.listLatestSamples(a)) || [];
    return {
      cards: document.querySelectorAll('#soundsTrack .sound-card').length,
      styles: latest.map((s) => ({
        name: s.name,
        pattern: s.visualParams && s.visualParams.strokePattern,
        palette0: s.visualParams && s.visualParams.palette && s.visualParams.palette[0]
      })),
      hasRealFiles: latest.every((s) => !!(s.file && s.file.size > 1000)),
      reports
    };
  }, payloads);

  console.log('\nNew Sounds ready (pick ALL 5 for max variety):');
  console.log(JSON.stringify(result, null, 2));
  console.log('\nIn Chrome:');
  console.log('  1) Select all 5 cards → Next Step');
  console.log('  2) Transform → Sound Brush');
  console.log('  3) Switch rows — each brush style/color should differ');
  console.log('  4) Use Brush → Draw');
  console.log('\nRefresh / Collect clears this temp session.');

  browser.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
