#!/usr/bin/env node
/**
 * Minimal ESP32 serial test — metrics JSON + button rec_start/rec_stop + PCM frames.
 * No WAV, no WebSocket, no protocol changes.
 *
 * Usage:
 *   node test-esp32-button.js
 *   SERIAL_PORT=/dev/cu.usbserial-0001 SERIAL_BAUD=500000 node test-esp32-button.js
 */

const { SerialPort } = require("serialport");

const PORT_PATH = process.env.SERIAL_PORT || "/dev/cu.usbserial-0001";
const BAUD = Number(process.env.SERIAL_BAUD || 500000);
const PCM_MAGIC = Buffer.from([0xa5, 0x5a, 0x01]);
const MAX_SAMPLES = 2048;

let byteBuffer = Buffer.alloc(0);
let textRemainder = "";
let recording = false;
let pcmCount = 0;

const port = new SerialPort({
  path: PORT_PATH,
  baudRate: BAUD,
  autoOpen: false
});

function onJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    console.log("[json?] " + trimmed.slice(0, 120));
    return;
  }

  if (msg.status === "rec_start") {
    recording = true;
    pcmCount = 0;
    console.log("BUTTON RECORD START" + (msg.source ? ` (source=${msg.source})` : ""));
    return;
  }

  if (msg.status === "rec_stop") {
    recording = false;
    console.log("BUTTON RECORD STOP" + (msg.source ? ` (source=${msg.source})` : ""));
    console.log(`  (received ${pcmCount} PCM frames this take)`);
    return;
  }

  if (msg.type === "metrics" || msg.volume != null || msg.sound != null) {
    if (!recording) {
      const vol = msg.volume != null ? Number(msg.volume).toFixed(2) : "?";
      const peak = msg.peak != null ? msg.peak : "?";
      const buttonRaw =
        msg.button_raw != null ? msg.button_raw : msg.btn != null ? msg.btn : "?";
      console.log(`metrics volume=${vol}% peak=${peak} button_raw=${buttonRaw}`);
    }
    return;
  }

  if (msg.status === "ready" || msg.debug) {
    console.log("[device]", JSON.stringify(msg));
  }
}

function processTextChunk(buf) {
  if (!buf || buf.length === 0) return;
  textRemainder += buf.toString("utf8");
  const parts = textRemainder.split("\n");
  textRemainder = parts.pop() || "";
  for (const line of parts) {
    if (line.trim()) onJsonLine(line);
  }
}

function handlePcmFrame(frame) {
  const seq = frame.readUInt16LE(3);
  const samples = frame.readUInt16LE(5);
  pcmCount += 1;

  if (!recording) {
    // First PCM without prior rec_start JSON — still treat as start
    recording = true;
    console.log("BUTTON RECORD START (inferred from first PCM)");
  }

  if (pcmCount <= 5 || pcmCount % 30 === 0) {
    console.log(`PCM FRAME seq=${seq} samples=${samples}`);
  }
}

function processByteBuffer() {
  while (byteBuffer.length > 0) {
    const magicIdx = byteBuffer.indexOf(PCM_MAGIC);

    if (magicIdx === -1) {
      if (byteBuffer.length <= 2) return;
      const keep = 2;
      processTextChunk(byteBuffer.slice(0, byteBuffer.length - keep));
      byteBuffer = byteBuffer.slice(byteBuffer.length - keep);
      return;
    }

    if (magicIdx > 0) {
      processTextChunk(byteBuffer.slice(0, magicIdx));
      byteBuffer = byteBuffer.slice(magicIdx);
    }

    if (byteBuffer.length < 7) return;

    const samples = byteBuffer.readUInt16LE(5);
    if (!Number.isFinite(samples) || samples <= 0 || samples > MAX_SAMPLES) {
      byteBuffer = byteBuffer.slice(1);
      continue;
    }

    const frameLen = 7 + samples * 2;
    if (byteBuffer.length < frameLen) return;

    const frame = byteBuffer.slice(0, frameLen);
    byteBuffer = byteBuffer.slice(frameLen);
    handlePcmFrame(frame);
  }
}

port.open((err) => {
  if (err) {
    console.error("SERIAL OPEN FAILED:", err.message);
    console.error("Close Arduino Serial Monitor / other apps using this port, then retry.");
    process.exit(1);
  }
  console.log("SERIAL OPEN");
  console.log(`  port=${PORT_PATH}  baud=${BAUD}`);
  console.log("Press Keyes on ESP32 to start/stop recording. Ctrl+C to quit.\n");
});

port.on("data", (chunk) => {
  byteBuffer = Buffer.concat([byteBuffer, chunk]);
  processByteBuffer();
});

port.on("error", (err) => {
  console.error("SERIAL ERROR:", err.message);
});

port.on("close", () => {
  console.log("SERIAL CLOSED");
});

process.on("SIGINT", () => {
  port.close(() => process.exit(0));
});
