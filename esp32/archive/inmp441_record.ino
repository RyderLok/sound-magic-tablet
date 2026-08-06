// ESP32 + INMP441 — 实时音量文字 + REC_START 时串流真实 PCM
// 接线: SCK=14, WS=15, SD=32, VDD=3.3V, GND=GND, L/R=GND
// 串口: 921600（PCM 需要高波特率，115200 无法传真实音频）
//
// 烧录后 Bridge: node serial-bridge.js --port COM3 --baud 921600

#include "driver/i2s.h"
#include <math.h>

static const int I2S_WS = 15;
static const int I2S_SD = 32;
static const int I2S_SCK = 14;
static const i2s_port_t I2S_PORT = I2S_NUM_0;

static const uint32_t SAMPLE_RATE = 16000;
static const size_t FRAME_SAMPLES = 512;

static const uint8_t PCM_MAGIC_0 = 0xA5;
static const uint8_t PCM_MAGIC_1 = 0x5A;
static const uint8_t PCM_TYPE = 0x01;

static int32_t sampleBuffer[FRAME_SAMPLES];
static int16_t pcmOut[FRAME_SAMPLES];
static bool recording = false;
static uint16_t pcmSeq = 0;
static uint32_t lastMetricsMs = 0;

static void initI2S() {
  i2s_config_t config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = FRAME_SAMPLES,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pins = {
    .bck_io_num = I2S_SCK,
    .ws_io_num = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD
  };

  ESP_ERROR_CHECK(i2s_driver_install(I2S_PORT, &config, 0, NULL));
  ESP_ERROR_CHECK(i2s_set_pin(I2S_PORT, &pins));
  ESP_ERROR_CHECK(i2s_set_clk(I2S_PORT, SAMPLE_RATE, I2S_BITS_PER_SAMPLE_32BIT, I2S_CHANNEL_MONO));
}

static int16_t toPcm16(int32_t raw32) {
  // INMP441: 24-bit audio in upper bits of 32-bit I2S word
  int32_t s = raw32 >> 11;
  if (s > 32767) return 32767;
  if (s < -32768) return -32768;
  return (int16_t)s;
}

static void pollSerialCommands() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      line.trim();
      if (line == "REC_START") {
        recording = true;
        pcmSeq = 0;
        for (int d = 0; d < 6; d++) {
          size_t br = 0;
          i2s_read(I2S_PORT, sampleBuffer, sizeof(sampleBuffer), &br, portMAX_DELAY);
        }
        Serial.println("{\"status\":\"rec_start\"}");
      } else if (line == "REC_STOP") {
        recording = false;
        Serial.println("{\"status\":\"rec_stop\"}");
      }
      line = "";
    } else {
      line += c;
      if (line.length() > 24) line.remove(0, line.length() - 24);
    }
  }
}

static void sendPcmFrame(const int16_t* samples, size_t count) {
  uint8_t header[7];
  header[0] = PCM_MAGIC_0;
  header[1] = PCM_MAGIC_1;
  header[2] = PCM_TYPE;
  header[3] = (uint8_t)(pcmSeq & 0xFF);
  header[4] = (uint8_t)((pcmSeq >> 8) & 0xFF);
  header[5] = (uint8_t)(count & 0xFF);
  header[6] = (uint8_t)((count >> 8) & 0xFF);
  Serial.write(header, 7);
  Serial.write((const uint8_t*)samples, count * sizeof(int16_t));
  pcmSeq++;
}

static void sendVolumeText(int32_t level, int32_t peak) {
  float pct = (level / 32768.0f) * 100.0f;
  if (pct < 0.0f) pct = 0.0f;
  if (pct > 100.0f) pct = 100.0f;

  if (pct > 8.0f) {
    Serial.println("🚨 检测到声音！");
    Serial.printf("🔊 音量: %.2f%%\n", pct);
    Serial.printf("📈 peak: %ld\n", (long)peak);
    Serial.println("----------------------");
  } else {
    Serial.println("静音中...");
  }
}

static void sendMetricsFrame(size_t count) {
  int64_t sumSq = 0;
  int32_t peak = 0;

  for (size_t i = 0; i < count; i++) {
    int16_t s = pcmOut[i];
    int32_t a = s < 0 ? -s : s;
    if (a > peak) peak = a;
    sumSq += (int64_t)s * (int64_t)s;
  }

  int32_t level = (int32_t)sqrt((double)sumSq / (double)count);
  uint32_t now = millis();
  if (now - lastMetricsMs >= 90) {
    lastMetricsMs = now;
    sendVolumeText(level, peak);
  }
}

void setup() {
  Serial.begin(921600);
  while (!Serial && millis() < 3000) delay(10);
  initI2S();
  Serial.println("{\"status\":\"ready\",\"pcm\":true,\"rate\":16000}");
}

void loop() {
  pollSerialCommands();

  size_t bytesRead = 0;
  esp_err_t err = i2s_read(
    I2S_PORT,
    sampleBuffer,
    sizeof(sampleBuffer),
    &bytesRead,
    portMAX_DELAY
  );

  if (err != ESP_OK || bytesRead == 0) return;

  const size_t count = bytesRead / sizeof(int32_t);
  if (count == 0) return;

  for (size_t i = 0; i < count; i++) {
    pcmOut[i] = toPcm16(sampleBuffer[i]);
  }

  if (recording) {
    sendPcmFrame(pcmOut, count);
  } else {
    sendMetricsFrame(count);
  }
}
