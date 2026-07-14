#!/usr/bin/env node
/**
 * ESP32 (INMP441) USB Serial → WebSocket bridge
 * Supports idle JSON/text metrics + binary PCM frames + record commands.
 * Usage: node serial-bridge.js --port COM3 [--baud 500000] [--ws 8765]
 *
 * Binary PCM frame (little-endian):
 *   0xA5 0x5A 0x01 | seq u16 | sampleCount u16 | PCM16[sampleCount]
 */

const { SerialPort } = require("serialport");
const { WebSocketServer } = require("ws");
const http = require("http");

function readArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || !process.argv[idx + 1]) return fallback;
  return process.argv[idx + 1];
}

const SERIAL_PORT = readArg("--port", process.env.SERIAL_PORT || "COM3");
const BAUD_RATE = Number(readArg("--baud", process.env.SERIAL_BAUD || "500000"));
const WS_PORT = Number(readArg("--ws", process.env.WS_PORT || "8765"));
const HEALTH_PORT = Number(readArg("--health", process.env.BRIDGE_HEALTH_PORT || "8766"));
const RECONNECT_MS = 2500;

/** Frame header: A5 5A 01 */
const PCM_MAGIC = Buffer.from([0xA5, 0x5A, 0x01]);
/** Expected samples per frame from firmware (also accept nearby valid counts). */
const EXPECTED_FRAME_SAMPLES = 512;
const MAX_FRAME_SAMPLES = 2048;
/**
 * If recording was started by first PCM (Keyes may skip rec_start JSON),
 * end only after this long with no PCM — not on brief gaps.
 */
const PCM_IDLE_STOP_MS = 2500;

let serial = null;
let reconnectTimer = null;
/** Raw serial byte cache — never toString() the whole stream blindly. */
let byteBuffer = Buffer.alloc(0);
let textRemainder = "";

const legacyState = { soundDetected: false, volumePct: 0, lastPeak: 0 };
let hardwareRecording = false;
/** true when recording entered via first PCM frame (no rec_start JSON yet). */
let recordingFromPcm = false;
let pcmFrameCount = 0;
let devicePcmCapable = false;
let lastPcmAt = 0;
let pcmIdleTimer = null;
/** After an explicit stop, ignore trailing PCM so in-flight frames do not re-arm recording. */
let ignorePcmAutostartUntil = 0;

const wss = new WebSocketServer({ port: WS_PORT });
const clients = new Set();

wss.on("listening", () => {
  console.log(`[ws] listening on ws://localhost:${WS_PORT}`);
});

function bridgeHealthPayload() {
  return {
    status: serial?.isOpen ? "ok" : "serial_closed",
    ws: `ws://127.0.0.1:${WS_PORT}`,
    wsListening: true,
    health: `http://127.0.0.1:${HEALTH_PORT}/health`,
    serial: {
      port: SERIAL_PORT,
      baud: BAUD_RATE,
      open: !!(serial && serial.isOpen)
    },
    pcm: devicePcmCapable,
    sampleRate: 16000,
    recording: hardwareRecording,
    clients: clients.size,
    timestamp: Date.now()
  };
}

const healthServer = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/health/") {
    const body = JSON.stringify(bridgeHealthPayload());
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(body);
    return;
  }
  res.writeHead(404);
  res.end();
});

healthServer.listen(HEALTH_PORT, "127.0.0.1", () => {
  console.log(`[health] http://127.0.0.1:${HEALTH_PORT}/health`);
});

wss.on("connection", (socket) => {
  clients.add(socket);
  console.log(`[ws] client connected (${clients.size} total)`);
  socket.send(JSON.stringify({
    type: "bridge",
    status: "connected",
    pcm: devicePcmCapable,
    sampleRate: 16000,
    serialOpen: !!(serial && serial.isOpen),
    serialPort: SERIAL_PORT,
    serialBaud: BAUD_RATE,
    recording: hardwareRecording,
    timestamp: Date.now()
  }));

  socket.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch (err) {
      return;
    }
    if (msg.cmd === "record_start") {
      startHardwareRecording("computer");
    } else if (msg.cmd === "record_stop") {
      stopHardwareRecording("computer");
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
    console.log(`[ws] client disconnected (${clients.size} total)`);
  });
});

function broadcast(payload) {
  const text = JSON.stringify(payload);
  let sent = 0;
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(text);
      sent += 1;
    }
  }
  return sent;
}

function writeSerial(line) {
  if (!serial?.isOpen) return;
  serial.write(line.endsWith("\n") ? line : `${line}\n`);
  console.log("[serial] cmd:", line.trim());
}

function clearPcmIdleTimer() {
  if (pcmIdleTimer) {
    clearTimeout(pcmIdleTimer);
    pcmIdleTimer = null;
  }
}

function armPcmIdleTimer() {
  clearPcmIdleTimer();
  // Only auto-stop when Keyes/device started PCM without an explicit stop path.
  if (!hardwareRecording || !recordingFromPcm) return;
  pcmIdleTimer = setTimeout(() => {
    if (!hardwareRecording || !recordingFromPcm) return;
    console.log(`[serial] PCM idle > ${PCM_IDLE_STOP_MS}ms — auto stop`);
    stopHardwareRecording("pcm_idle", { writeSerialCmd: false });
  }, PCM_IDLE_STOP_MS);
}

/**
 * Enter recording. source: computer | button | pcm | device
 * writeSerialCmd: send REC_START to ESP32 (skip when device already streaming).
 */
function startHardwareRecording(source = "computer", options = {}) {
  const writeSerialCmd = options.writeSerialCmd !== false && source === "computer";
  const already = hardwareRecording;

  if (!already) {
    hardwareRecording = true;
    recordingFromPcm = source === "pcm";
    pcmFrameCount = 0;
    ignorePcmAutostartUntil = 0;
  } else if (source === "computer") {
    recordingFromPcm = false;
  }

  if (writeSerialCmd) {
    writeSerial("REC_START");
  }

  // hw_record only on true edge — avoids restarting UI capture mid-take
  if (!already) {
    broadcast({
      type: "hw_record",
      status: "started",
      source,
      timestamp: Date.now()
    });
    console.log("[serial] recording started, source:", source);
  }

  broadcast({
    type: "record_ack",
    status: "started",
    source,
    timestamp: Date.now()
  });
}

/**
 * Exit recording. Prefer explicit REC_STOP / UI stop over short silence.
 */
function stopHardwareRecording(source = "computer", options = {}) {
  const writeSerialCmd = options.writeSerialCmd !== false && (
    source === "computer" || source === "ui"
  );

  clearPcmIdleTimer();
  const wasRecording = hardwareRecording;
  hardwareRecording = false;
  recordingFromPcm = false;
  ignorePcmAutostartUntil = Date.now() + 800;

  if (writeSerialCmd) {
    writeSerial("REC_STOP");
  }

  if (wasRecording) {
    broadcast({
      type: "hw_record",
      status: "stopped",
      source,
      timestamp: Date.now()
    });
    console.log("[serial] recording stopped, source:", source);
  }

  broadcast({
    type: "record_ack",
    status: "stopped",
    source,
    timestamp: Date.now()
  });
}

function clampNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function metricsFromLegacy() {
  const pct = legacyState.volumePct / 100;
  const level = Math.round(pct * 15000 + 200);
  const peak = legacyState.lastPeak > 0
    ? legacyState.lastPeak
    : legacyState.soundDetected
      ? Math.round(8000 + pct * 40000)
      : Math.round(pct * 3000 + 500);
  const mean = legacyState.soundDetected ? Math.round(pct * 500 - 250) : 0;
  return {
    level,
    peak,
    mean,
    volumePct: legacyState.volumePct,
    timestamp: Date.now(),
    source: "legacy"
  };
}

function parseMetricsLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed[0] === "{") {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      console.warn("[serial] invalid JSON:", trimmed.slice(0, 120));
      return null;
    }
    if (parsed.status === "ready" && parsed.pcm) {
      devicePcmCapable = true;
      console.log("[serial] device PCM capable @", parsed.rate || 16000);
      broadcast({
        type: "bridge",
        status: "connected",
        pcm: true,
        sampleRate: parsed.rate || 16000,
        serialBaud: BAUD_RATE,
        timestamp: Date.now()
      });
      return null;
    }
    if (parsed.status === "rec_start" || parsed.status === "rec_stop") {
      devicePcmCapable = true;
      const started = parsed.status === "rec_start";
      const source = parsed.source || "device";
      if (started) {
        startHardwareRecording(source, { writeSerialCmd: false });
      } else {
        stopHardwareRecording(source, { writeSerialCmd: false });
      }
      return null;
    }
    // Ignore other JSON while recording — avoid polluting UI with idle metrics.
    if (hardwareRecording) return null;

    // New firmware: {"type":"metrics","sound":true,"volume":12.3,"peak":3000}
    if (parsed.type === "metrics" || parsed.volume != null || parsed.sound != null) {
      const volumePct = Number(parsed.volume);
      if (Number.isFinite(volumePct)) {
        legacyState.volumePct = Math.max(0, Math.min(100, volumePct));
      }
      if (parsed.peak != null) {
        legacyState.lastPeak = clampNumber(parsed.peak);
      }
      if (parsed.sound === true || parsed.sound === "true") {
        legacyState.soundDetected = true;
      } else if (parsed.sound === false || parsed.sound === "false") {
        legacyState.soundDetected = false;
      }
      const fromLegacy = metricsFromLegacy();
      // Prefer raw peak/level from device when present
      if (parsed.level != null) fromLegacy.level = clampNumber(parsed.level);
      if (parsed.peak != null) fromLegacy.peak = clampNumber(parsed.peak);
      if (parsed.mean != null) fromLegacy.mean = clampNumber(parsed.mean);
      return fromLegacy;
    }

    return {
      level: clampNumber(parsed.level),
      peak: clampNumber(parsed.peak),
      mean: clampNumber(parsed.mean),
      timestamp: Date.now(),
      source: "json"
    };
  }

  if (hardwareRecording) return null;

  const volMatch = trimmed.match(/音量[:：]\s*(\d+(?:\.\d+)?)\s*%/);
  if (volMatch) {
    legacyState.volumePct = parseFloat(volMatch[1]);
    return metricsFromLegacy();
  }

  const loosePct = trimmed.match(/(\d+(?:\.\d+)?)\s*%/);
  if (loosePct && !/peak/i.test(trimmed)) {
    legacyState.volumePct = parseFloat(loosePct[1]);
    return metricsFromLegacy();
  }

  const peakMatch = trimmed.match(/peak[:：]\s*(\d+)/i);
  if (peakMatch) {
    legacyState.lastPeak = parseInt(peakMatch[1], 10);
    if (legacyState.volumePct > 0) return metricsFromLegacy();
    return null;
  }

  if (trimmed.includes("声音") && (trimmed.includes("检测") || trimmed.includes("🚨"))) {
    legacyState.soundDetected = true;
    return metricsFromLegacy();
  }
  if (trimmed.includes("静音")) {
    legacyState.soundDetected = false;
    legacyState.volumePct = 0;
    return metricsFromLegacy();
  }

  return null;
}

function metricsFromPcm(pcmBuf) {
  const n = Math.floor(pcmBuf.length / 2);
  if (n === 0) return null;
  let sumSq = 0;
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = pcmBuf.readInt16LE(i * 2);
    sum += s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
    sumSq += s * s;
  }
  return {
    level: Math.round(Math.sqrt(sumSq / n)),
    peak,
    mean: Math.round(sum / n),
    timestamp: Date.now(),
    source: "pcm"
  };
}

/** Parse newline-delimited UTF-8 text that sits between binary frames. */
function processTextChunk(buf) {
  if (!buf || buf.length === 0) return;
  textRemainder += buf.toString("utf8");
  const parts = textRemainder.split("\n");
  textRemainder = parts.pop() || "";
  for (const line of parts) {
    if (!line.trim()) continue;
    console.log("[serial] raw:", line);
    const metrics = parseMetricsLine(line);
    if (!metrics) continue;
    console.log("[serial] parsed:", metrics);
    broadcast(metrics);
  }
}

function handlePcmFrame(frameBuf) {
  const seq = frameBuf.readUInt16LE(3);
  const count = frameBuf.readUInt16LE(5);
  const pcm = frameBuf.slice(7, 7 + count * 2);

  // Keyes may start streaming PCM without a prior rec_start JSON.
  if (!hardwareRecording) {
    if (Date.now() < ignorePcmAutostartUntil) {
      // Trailing frames after stop — keep live meter, do not re-arm recording.
      const metricsOnly = metricsFromPcm(pcm);
      if (metricsOnly) broadcast(metricsOnly);
      return;
    }
    startHardwareRecording("pcm", { writeSerialCmd: false });
  }

  pcmFrameCount += 1;
  lastPcmAt = Date.now();
  armPcmIdleTimer();

  if (!devicePcmCapable) {
    devicePcmCapable = true;
    broadcast({
      type: "bridge",
      status: "connected",
      pcm: true,
      sampleRate: 16000,
      timestamp: Date.now()
    });
  }

  if (pcmFrameCount <= 3 || pcmFrameCount % 30 === 0) {
    console.log(`[serial] pcm frame #${pcmFrameCount} seq=${seq} samples=${count}`);
  }

  // PCM payload is base64 in JSON — never broadcast raw binary as a string.
  broadcast({
    type: "pcm",
    seq,
    sampleRate: 16000,
    samples: count,
    data: pcm.toString("base64"),
    timestamp: Date.now()
  });

  const metrics = metricsFromPcm(pcm);
  if (metrics) broadcast(metrics);
}

/**
 * Streaming frame parser:
 * - serial chunks may be half / one / many frames
 * - search for A5 5A 01, read seq + sampleCount, wait for full PCM
 * - on bad length, skip one byte and resync
 * - keep a possible partial magic prefix (do not toString the whole buffer)
 */
function processByteBuffer() {
  while (byteBuffer.length > 0) {
    const magicIdx = byteBuffer.indexOf(PCM_MAGIC);

    if (magicIdx === -1) {
      // No full magic yet — keep last 2 bytes in case they are a partial header.
      if (byteBuffer.length <= 2) return;
      const keep = 2;
      const textPart = byteBuffer.slice(0, byteBuffer.length - keep);
      byteBuffer = byteBuffer.slice(byteBuffer.length - keep);
      processTextChunk(textPart);
      return;
    }

    if (magicIdx > 0) {
      processTextChunk(byteBuffer.slice(0, magicIdx));
      byteBuffer = byteBuffer.slice(magicIdx);
    }

    // Need header: magic(3) + seq(2) + sampleCount(2)
    if (byteBuffer.length < 7) return;

    const count = byteBuffer.readUInt16LE(5);
    const validCount =
      Number.isFinite(count) &&
      count > 0 &&
      count <= MAX_FRAME_SAMPLES;

    if (!validCount) {
      // Corrupt header — drop first byte and search again.
      console.warn("[serial] bad sampleCount", count, "— resync");
      byteBuffer = byteBuffer.slice(1);
      continue;
    }

    const frameLen = 7 + count * 2;
    if (byteBuffer.length < frameLen) return;

    const frame = byteBuffer.slice(0, frameLen);
    byteBuffer = byteBuffer.slice(frameLen);
    handlePcmFrame(frame);
  }
}

function formatSerialOpenError(err) {
  const msg = err && err.message ? err.message : String(err);
  const busy = /access denied|cannot open|EACCES|EBUSY|Resource busy|Permission denied|in use|失败|占用/i.test(msg);
  let out = `[serial] cannot open ${SERIAL_PORT} @ ${BAUD_RATE}: ${msg}`;
  if (busy) {
    out +=
      "\n[serial] Port is likely busy. Close Arduino Serial Monitor (串口监视器) " +
      "and any other app using this COM / cu.* port, then restart the bridge.";
  }
  return out;
}

function attachSerialHandlers() {
  serial.on("data", (chunk) => {
    // Always append as Buffer; never String(chunk) the mixed binary stream.
    byteBuffer = Buffer.concat([byteBuffer, chunk]);
    processByteBuffer();
  });

  serial.on("open", () => {
    console.log(`[serial] open ${SERIAL_PORT} @ ${BAUD_RATE}`);
    byteBuffer = Buffer.alloc(0);
    textRemainder = "";
    broadcast({
      type: "bridge",
      status: "serial_open",
      pcm: devicePcmCapable,
      sampleRate: 16000,
      serialOpen: true,
      serialPort: SERIAL_PORT,
      serialBaud: BAUD_RATE,
      recording: hardwareRecording,
      timestamp: Date.now()
    });
  });

  serial.on("error", (err) => {
    console.error(formatSerialOpenError(err));
  });

  serial.on("close", () => {
    console.warn("[serial] closed — reconnecting…");
    scheduleReconnect();
  });
}

function openSerial() {
  if (serial && serial.isOpen) return;

  try {
    serial = new SerialPort({
      path: SERIAL_PORT,
      baudRate: BAUD_RATE,
      autoOpen: true
    });
    attachSerialHandlers();
  } catch (err) {
    console.error(formatSerialOpenError(err));
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    try {
      if (serial) {
        serial.removeAllListeners();
        serial.close(() => openSerial());
      } else {
        openSerial();
      }
    } catch (err) {
      console.error("[serial] reconnect failed:", err.message);
      scheduleReconnect();
    }
  }, RECONNECT_MS);
}

openSerial();

process.on("SIGINT", () => {
  console.log("\n[bridge] shutting down");
  clearPcmIdleTimer();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  for (const client of clients) client.close();
  wss.close();
  healthServer.close();
  if (serial && serial.isOpen) {
    serial.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
});
