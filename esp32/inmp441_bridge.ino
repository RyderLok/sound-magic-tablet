#include <Arduino.h>
#include <driver/i2s.h>
#include <string.h>
#include <math.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>

// =====================================================
// INMP441 接线
// SCK = GPIO14
// WS  = GPIO15
// SD  = GPIO32
// VDD = 3.3V
// GND = GND
// L/R = GND
// =====================================================
#define I2S_SCK 14
#define I2S_WS  15
#define I2S_SD  32

#define I2S_PORT I2S_NUM_0

// =====================================================
// Keyes 按钮接线
// S = GPIO25
// + = 3.3V
// - = GND
// =====================================================
#define BUTTON_PIN 25

// 已根据纯按钮测试确认：
// 松开 = HIGH
// 按下 = LOW
#define BUTTON_ACTIVE_LEVEL LOW

// 软件消抖时间
#define BUTTON_DEBOUNCE_MS 40

// =====================================================
// ST7735 128×160 SPI TFT（避开 I2S / 按钮脚）
// 部分 DevKit 无 GPIO16/17 引出，改用 26/27
// CS=5  DC=26  RST=27  MOSI=23  SCLK=18  BL=4
// VCC=3.3V  GND=GND
// =====================================================
#define TFT_CS   5
#define TFT_DC   26
#define TFT_RST  27
#define TFT_MOSI 23
#define TFT_SCLK 18
#define TFT_BL   4

Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_MOSI, TFT_SCLK, TFT_RST);

enum TftState {
  TFT_STATE_READY = 0,
  TFT_STATE_RECORDING,
  TFT_STATE_SAVING,
  TFT_STATE_UPLOADING,
  TFT_STATE_DONE,
  TFT_STATE_ERROR
};

TftState tftState = TFT_STATE_READY;
unsigned long tftStateSince = 0;
#define TFT_UPLOAD_TIMEOUT_MS 20000
#define TFT_DONE_HOLD_MS 2500

// =====================================================
// 录音中 TFT 实时频谱（确认 INMP441 有输入）
// 160×128 landscape：顶栏 REC + 下方柱状频谱
// =====================================================
#define FFT_N 256
#define SPECTRUM_BARS 32
#define SPECTRUM_INTERVAL_MS 80
#define SPEC_TOP 18
#define SPEC_BOTTOM 126
#define SPEC_LEFT 2
#define SPEC_RIGHT 158
// 低于此幅度视为安静（与 SOUND_THRESHOLD 同量级，避免空噪声刷满屏）
#define SPECTRUM_FLOOR 5000.0f
// 与前端 FieldRecorder.MAX_DURATION_SEC=20 对齐
#define RECORD_MAX_MS 20000UL

float fftReal[FFT_N];
float fftImag[FFT_N];
uint8_t spectrumBars[SPECTRUM_BARS];
uint8_t spectrumBarsPrev[SPECTRUM_BARS];
unsigned long lastSpectrumTime = 0;
bool spectrumViewReady = false;
unsigned long recordingStartedAt = 0;
int lastTimerSecShown = -1;

// =====================================================
// 音频参数
// =====================================================
#define SAMPLE_RATE   16000
#define FRAME_SAMPLES 512

// =====================================================
// 串口参数
// 必须与 Node 测试脚本一致
// =====================================================
#define SERIAL_BAUD_RATE 500000

// =====================================================
// 调试参数
// =====================================================
#define METRICS_INTERVAL_MS 150
#define SOUND_THRESHOLD 3000

// =====================================================
// 录音状态
// =====================================================
bool recording = false;
uint16_t seq = 0;

// =====================================================
// 音频缓冲区
// =====================================================
int32_t i2sBuffer[FRAME_SAMPLES];
int16_t pcmBuffer[FRAME_SAMPLES];

// =====================================================
// 按钮消抖状态
// INPUT_PULLUP 下默认松开为 HIGH
// =====================================================
int lastButtonReading = HIGH;
int stableButtonState = HIGH;
unsigned long lastButtonChangeTime = 0;

// =====================================================
// metrics 输出计时
// =====================================================
unsigned long lastMetricsTime = 0;

// =====================================================
// 串口命令缓冲区
// =====================================================
char commandBuffer[48];
size_t commandLength = 0;

// =====================================================
// TFT 状态显示 + 录音频谱
// =====================================================
const char *tftStateLabel(TftState state) {
  switch (state) {
    case TFT_STATE_RECORDING: return "Recording";
    case TFT_STATE_SAVING: return "Saving";
    case TFT_STATE_UPLOADING: return "Uploading";
    case TFT_STATE_DONE: return "Done";
    case TFT_STATE_ERROR: return "Error";
    case TFT_STATE_READY:
    default: return "Ready";
  }
}

uint16_t tftStateColor(TftState state) {
  switch (state) {
    case TFT_STATE_RECORDING: return ST77XX_RED;
    case TFT_STATE_SAVING: return ST77XX_YELLOW;
    case TFT_STATE_UPLOADING: return ST77XX_CYAN;
    case TFT_STATE_DONE: return ST77XX_GREEN;
    case TFT_STATE_ERROR: return ST77XX_MAGENTA;
    case TFT_STATE_READY:
    default: return ST77XX_WHITE;
  }
}

void resetSpectrumBars() {
  memset(spectrumBars, 0, sizeof(spectrumBars));
  memset(spectrumBarsPrev, 0, sizeof(spectrumBarsPrev));
  lastSpectrumTime = 0;
  spectrumViewReady = false;
}

// 原地 radix-2 FFT（float，无外部库）
void fftRadix2(float *real, float *imag, int n) {
  int j = 0;
  for (int i = 0; i < n - 1; i++) {
    if (i < j) {
      float tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      float ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
    int k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  for (int len = 2; len <= n; len <<= 1) {
    float ang = -2.0f * PI / static_cast<float>(len);
    float wlenRe = cosf(ang);
    float wlenIm = sinf(ang);
    for (int i = 0; i < n; i += len) {
      float wRe = 1.0f;
      float wIm = 0.0f;
      int half = len >> 1;
      for (int k = 0; k < half; k++) {
        int i0 = i + k;
        int i1 = i0 + half;
        float tRe = wRe * real[i1] - wIm * imag[i1];
        float tIm = wRe * imag[i1] + wIm * real[i1];
        real[i1] = real[i0] - tRe;
        imag[i1] = imag[i0] - tIm;
        real[i0] += tRe;
        imag[i0] += tIm;
        float nextRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextRe;
      }
    }
  }
}

void beginSpectrumView() {
  resetSpectrumBars();
  spectrumViewReady = true;
  lastTimerSecShown = -1;

  tft.fillScreen(ST77XX_BLACK);
  tft.setTextWrap(false);
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_RED);
  tft.setCursor(4, 4);
  tft.print("REC");
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(32, 4);
  tft.print("spectrum");

  // 底部分隔线
  tft.drawFastHLine(0, SPEC_TOP - 2, tft.width(), ST77XX_WHITE);
  drawRecordingTimer(millis());
}

// 顶栏右侧倒计时：20s → 0s
void drawRecordingTimer(unsigned long now) {
  if (!spectrumViewReady) {
    return;
  }

  unsigned long elapsed = 0;
  if (recordingStartedAt != 0 && now >= recordingStartedAt) {
    elapsed = now - recordingStartedAt;
  }
  if (elapsed > RECORD_MAX_MS) {
    elapsed = RECORD_MAX_MS;
  }

  int remainSec = static_cast<int>(
    (RECORD_MAX_MS - elapsed + 999UL) / 1000UL
  );
  if (remainSec < 0) {
    remainSec = 0;
  }
  if (remainSec == lastTimerSecShown) {
    return;
  }
  lastTimerSecShown = remainSec;

  tft.fillRect(108, 2, 52, 12, ST77XX_BLACK);
  tft.setTextWrap(false);
  tft.setTextSize(1);
  tft.setTextColor(
    remainSec <= 3 ? ST77XX_RED : ST77XX_YELLOW
  );
  tft.setCursor(114, 4);
  if (remainSec < 10) {
    tft.print(' ');
  }
  tft.print(remainSec);
  tft.print('s');
}

void drawSpectrumBars() {
  const int plotW = SPEC_RIGHT - SPEC_LEFT;
  const int plotH = SPEC_BOTTOM - SPEC_TOP;
  const int barW = plotW / SPECTRUM_BARS;
  if (barW <= 0 || plotH <= 0) {
    return;
  }

  for (int b = 0; b < SPECTRUM_BARS; b++) {
    uint8_t h = spectrumBars[b];
    uint8_t prev = spectrumBarsPrev[b];
    if (h == prev) {
      continue;
    }

    int x = SPEC_LEFT + b * barW;
    int bw = barW - 1;
    if (bw < 1) bw = 1;

    int bh = (static_cast<int>(h) * plotH) / 255;
    int prevBh = (static_cast<int>(prev) * plotH) / 255;

    if (bh < prevBh) {
      tft.fillRect(
        x,
        SPEC_BOTTOM - prevBh,
        bw,
        prevBh - bh,
        ST77XX_BLACK
      );
    }

    if (bh > 0) {
      uint16_t color = ST77XX_GREEN;
      if (h > 200) {
        color = ST77XX_RED;
      } else if (h > 120) {
        color = ST77XX_YELLOW;
      }
      tft.fillRect(
        x,
        SPEC_BOTTOM - bh,
        bw,
        bh,
        color
      );
    }

    spectrumBarsPrev[b] = h;
  }
}

void computeSpectrumBars(const int16_t *pcm, int sampleCount) {
  if (sampleCount <= 0) {
    memset(spectrumBars, 0, sizeof(spectrumBars));
    return;
  }

  for (int i = 0; i < FFT_N; i++) {
    float sample = 0.0f;
    if (i < sampleCount) {
      sample = static_cast<float>(pcm[i]);
    }
    // Hann 窗
    float w = 0.5f * (
      1.0f - cosf(
        2.0f * PI * static_cast<float>(i) /
        static_cast<float>(FFT_N - 1)
      )
    );
    fftReal[i] = sample * w;
    fftImag[i] = 0.0f;
  }

  fftRadix2(fftReal, fftImag, FFT_N);

  const int usable = FFT_N / 2;
  float mags[SPECTRUM_BARS];
  float peak = SPECTRUM_FLOOR;

  for (int b = 0; b < SPECTRUM_BARS; b++) {
    int i0 = 1 + (b * (usable - 1)) / SPECTRUM_BARS;
    int i1 = 1 + ((b + 1) * (usable - 1)) / SPECTRUM_BARS;
    if (i1 <= i0) {
      i1 = i0 + 1;
    }

    float maxM = 0.0f;
    for (int i = i0; i < i1 && i < usable; i++) {
      float re = fftReal[i];
      float im = fftImag[i];
      float m = sqrtf(re * re + im * im);
      if (m > maxM) {
        maxM = m;
      }
    }
    mags[b] = maxM;
    if (maxM > peak) {
      peak = maxM;
    }
  }

  // 轻微参考：有声时柱高明显；安静时接近底部
  float scale = peak;
  if (scale < SPECTRUM_FLOOR) {
    scale = SPECTRUM_FLOOR;
  }

  for (int b = 0; b < SPECTRUM_BARS; b++) {
    float norm = mags[b] / scale;
    if (norm < 0.0f) norm = 0.0f;
    if (norm > 1.0f) norm = 1.0f;
    spectrumBars[b] = static_cast<uint8_t>(norm * 255.0f);
  }
}

void updateSpectrumDisplay(const int16_t *pcm, int sampleCount) {
  if (!spectrumViewReady || tftState != TFT_STATE_RECORDING) {
    return;
  }

  unsigned long now = millis();
  if (
    lastSpectrumTime != 0 &&
    now - lastSpectrumTime < SPECTRUM_INTERVAL_MS
  ) {
    return;
  }
  lastSpectrumTime = now;

  computeSpectrumBars(pcm, sampleCount);
  drawSpectrumBars();
  drawRecordingTimer(now);
}

void pollRecordingTimeout() {
  if (!recording || recordingStartedAt == 0) {
    return;
  }
  if (millis() - recordingStartedAt >= RECORD_MAX_MS) {
    setRecording(false, "timeout");
  }
}

void showTftState(TftState state) {
  tftState = state;
  tftStateSince = millis();

  if (state == TFT_STATE_RECORDING) {
    beginSpectrumView();
    return;
  }

  resetSpectrumBars();

  tft.fillScreen(ST77XX_BLACK);
  tft.setTextWrap(false);
  tft.setTextSize(2);
  tft.setTextColor(tftStateColor(state));

  const char *label = tftStateLabel(state);
  int16_t x1, y1;
  uint16_t w, h;
  tft.getTextBounds(label, 0, 0, &x1, &y1, &w, &h);
  int16_t x = (int16_t)((tft.width() - (int)w) / 2);
  int16_t y = (int16_t)((tft.height() - (int)h) / 2);
  if (x < 0) x = 2;
  if (y < 0) y = 2;
  tft.setCursor(x, y);
  tft.print(label);
}

void setupTft() {
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);
  // Many 128x160 red-tab modules use INITR_BLACKTAB / INITR_GREENTAB;
  // BLACKTAB is the safest default — change if colors look inverted.
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(1); // landscape 160×128
  tft.fillScreen(ST77XX_BLACK);
  showTftState(TFT_STATE_READY);
}

void pollTftTimeouts() {
  unsigned long now = millis();
  if (
    tftState == TFT_STATE_UPLOADING &&
    now - tftStateSince >= TFT_UPLOAD_TIMEOUT_MS
  ) {
    showTftState(TFT_STATE_ERROR);
    return;
  }
  if (
    tftState == TFT_STATE_DONE &&
    now - tftStateSince >= TFT_DONE_HOLD_MS
  ) {
    showTftState(TFT_STATE_READY);
  }
}

// =====================================================
// 将 INMP441 32-bit I2S 数据转换为 PCM16
// =====================================================
int16_t toPcm16(int32_t raw) {
  int32_t sample = raw >> 14;

  if (sample > 32767) {
    sample = 32767;
  }

  if (sample < -32768) {
    sample = -32768;
  }

  return static_cast<int16_t>(sample);
}

// =====================================================
// 输出录音边界事件
//
// 开始录音前输出 rec_start。
// 停止录音后输出 rec_stop。
// =====================================================
void sendRecordingEvent(bool started, const char *source) {
  Serial.print("{\"status\":\"");

  if (started) {
    Serial.print("rec_start");
  } else {
    Serial.print("rec_stop");
  }

  Serial.print("\",\"source\":\"");
  Serial.print(source);
  Serial.println("\"}");
}

// =====================================================
// 统一修改 recording 状态
//
// 按钮和电脑端命令都调用这里。
// =====================================================
void setRecording(bool enabled, const char *source) {
  if (recording == enabled) {
    return;
  }

  if (enabled) {
    // 先发送开始事件
    sendRecordingEvent(true, source);
    Serial.flush();

    seq = 0;
    recording = true;
    recordingStartedAt = millis();
    lastTimerSecShown = -1;
    lastMetricsTime = millis();
    showTftState(TFT_STATE_RECORDING);

    return;
  }

  // 先停止继续发送 PCM
  recording = false;
  recordingStartedAt = 0;
  lastTimerSecShown = -1;

  // 等待已进入串口缓冲区的 PCM 发完
  Serial.flush();

  // 再发送停止事件
  sendRecordingEvent(false, source);
  Serial.flush();

  lastMetricsTime = millis();
  // Bridge will drive Saving → Uploading → Done/Error via TFT_* commands
  showTftState(TFT_STATE_SAVING);
}

// =====================================================
// 从 INMP441 读取一帧，并转换为 PCM16
// =====================================================
int readPcmFrame() {
  size_t bytesRead = 0;

  esp_err_t result = i2s_read(
    I2S_PORT,
    i2sBuffer,
    sizeof(i2sBuffer),
    &bytesRead,
    portMAX_DELAY
  );

  if (result != ESP_OK || bytesRead == 0) {
    return 0;
  }

  int sampleCount =
    static_cast<int>(bytesRead / sizeof(int32_t));

  if (sampleCount > FRAME_SAMPLES) {
    sampleCount = FRAME_SAMPLES;
  }

  for (int i = 0; i < sampleCount; i++) {
    pcmBuffer[i] = toPcm16(i2sBuffer[i]);
  }

  return sampleCount;
}

// =====================================================
// 按协议发送 PCM16 二进制帧
//
// 协议：
// 0xA5 0x5A 0x01
// seq：u16 little-endian
// sampleCount：u16 little-endian
// PCM16 数据
// =====================================================
void sendPcmFrame(int sampleCount) {
  if (sampleCount <= 0) {
    return;
  }

  uint8_t header[7];

  header[0] = 0xA5;
  header[1] = 0x5A;
  header[2] = 0x01;

  header[3] =
    static_cast<uint8_t>(seq & 0xFF);

  header[4] =
    static_cast<uint8_t>((seq >> 8) & 0xFF);

  uint16_t count =
    static_cast<uint16_t>(sampleCount);

  header[5] =
    static_cast<uint8_t>(count & 0xFF);

  header[6] =
    static_cast<uint8_t>((count >> 8) & 0xFF);

  Serial.write(
    header,
    sizeof(header)
  );

  Serial.write(
    reinterpret_cast<const uint8_t *>(pcmBuffer),
    sampleCount * sizeof(int16_t)
  );

  seq++;
}

// =====================================================
// 计算平均绝对幅值和峰值
// =====================================================
float computeVolume(
  const int16_t *buffer,
  int sampleCount,
  int32_t &peakOut
) {
  if (sampleCount <= 0) {
    peakOut = 0;
    return 0.0f;
  }

  uint64_t sum = 0;
  int32_t peak = 0;

  for (int i = 0; i < sampleCount; i++) {
    int32_t value =
      static_cast<int32_t>(buffer[i]);

    if (value < 0) {
      value = -value;
    }

    sum += static_cast<uint32_t>(value);

    if (value > peak) {
      peak = value;
    }
  }

  peakOut = peak;

  return static_cast<float>(sum) /
         static_cast<float>(sampleCount);
}

// =====================================================
// 未录音时输出 metrics JSON
//
// button_raw：
// 松开通常为 1
// 按下通常为 0
// =====================================================
void printMetrics(int sampleCount) {
  if (recording || sampleCount <= 0) {
    return;
  }

  int32_t peak = 0;

  float level = computeVolume(
    pcmBuffer,
    sampleCount,
    peak
  );

  float percent =
    (level / 32768.0f) * 100.0f;

  if (percent > 100.0f) {
    percent = 100.0f;
  }

  bool soundDetected =
    peak > SOUND_THRESHOLD;

  int buttonRaw =
    digitalRead(BUTTON_PIN);

  Serial.print(
    "{\"type\":\"metrics\",\"sound\":"
  );

  Serial.print(
    soundDetected ? "true" : "false"
  );

  Serial.print(",\"volume\":");
  Serial.print(percent, 2);

  Serial.print(",\"peak\":");
  Serial.print(peak);

  Serial.print(",\"button_raw\":");
  Serial.print(buttonRaw);

  Serial.println("}");
}

// =====================================================
// 输出空闲状态
//
// 录音期间 STATUS 不输出，避免污染 PCM。
// =====================================================
void sendIdleStatus() {
  if (recording) {
    return;
  }

  Serial.println(
    "{\"status\":\"idle\","
    "\"recording\":false,"
    "\"pcm\":true,"
    "\"rate\":16000,"
    "\"frame_samples\":512,"
    "\"button\":true,"
    "\"button_pin\":25}"
  );
}

// =====================================================
// 处理电脑端串口命令
// =====================================================
void handleSerialCommand(const char *command) {
  if (strcmp(command, "REC_START") == 0) {
    setRecording(true, "computer");
    return;
  }

  if (strcmp(command, "REC_STOP") == 0) {
    setRecording(false, "computer");
    return;
  }

  if (strcmp(command, "REC_TOGGLE") == 0) {
    setRecording(!recording, "computer");
    return;
  }

  if (strcmp(command, "STATUS") == 0) {
    if (!recording) {
      sendIdleStatus();
    }

    return;
  }

  if (strcmp(command, "TFT_READY") == 0) {
    if (!recording) showTftState(TFT_STATE_READY);
    return;
  }
  if (strcmp(command, "TFT_RECORDING") == 0) {
    // 已在录音频谱视图时不要整屏重绘，避免 Bridge 回写冲掉动画
    if (tftState != TFT_STATE_RECORDING || !spectrumViewReady) {
      showTftState(TFT_STATE_RECORDING);
    }
    return;
  }
  if (strcmp(command, "TFT_SAVING") == 0) {
    showTftState(TFT_STATE_SAVING);
    return;
  }
  if (strcmp(command, "TFT_UPLOADING") == 0) {
    showTftState(TFT_STATE_UPLOADING);
    return;
  }
  if (strcmp(command, "TFT_DONE") == 0) {
    showTftState(TFT_STATE_DONE);
    return;
  }
  if (strcmp(command, "TFT_ERROR") == 0) {
    showTftState(TFT_STATE_ERROR);
    return;
  }
}

// =====================================================
// 非阻塞读取串口命令
// =====================================================
void pollSerial() {
  while (Serial.available() > 0) {
    int incoming = Serial.read();

    if (incoming < 0) {
      break;
    }

    char currentChar =
      static_cast<char>(incoming);

    if (
      currentChar == '\n' ||
      currentChar == '\r'
    ) {
      if (commandLength > 0) {
        commandBuffer[commandLength] = '\0';

        handleSerialCommand(
          commandBuffer
        );

        commandLength = 0;
      }

      continue;
    }

    if (
      commandLength <
      sizeof(commandBuffer) - 1
    ) {
      commandBuffer[commandLength] =
        currentChar;

      commandLength++;
    } else {
      commandLength = 0;
    }
  }
}

// =====================================================
// Keyes 按钮检测与 40ms 软件消抖
//
// 当前逻辑：
// 松开 = HIGH
// 按下 = LOW
//
// 只在确认进入 LOW 时切换 recording。
// =====================================================
void pollButton() {
  int reading =
    digitalRead(BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastButtonReading = reading;
    lastButtonChangeTime = millis();
  }

  if (
    reading != stableButtonState &&
    millis() - lastButtonChangeTime >=
      BUTTON_DEBOUNCE_MS
  ) {
    stableButtonState = reading;

    if (
      stableButtonState ==
      BUTTON_ACTIVE_LEVEL
    ) {
      setRecording(
        !recording,
        "button"
      );
    }
  }
}

// =====================================================
// 初始化 INMP441 I2S
// =====================================================
bool setupI2S() {
  i2s_config_t config = {};

  config.mode =
    static_cast<i2s_mode_t>(
      I2S_MODE_MASTER |
      I2S_MODE_RX
    );

  config.sample_rate =
    SAMPLE_RATE;

  config.bits_per_sample =
    I2S_BITS_PER_SAMPLE_32BIT;

  // L/R 接 GND，读取左声道
  config.channel_format =
    I2S_CHANNEL_FMT_ONLY_LEFT;

  config.communication_format =
    I2S_COMM_FORMAT_I2S;

  config.intr_alloc_flags =
    ESP_INTR_FLAG_LEVEL1;

  config.dma_buf_count = 8;
  config.dma_buf_len = 64;

  config.use_apll = false;
  config.tx_desc_auto_clear = false;
  config.fixed_mclk = 0;

  i2s_pin_config_t pinConfig = {};

  pinConfig.bck_io_num =
    I2S_SCK;

  pinConfig.ws_io_num =
    I2S_WS;

  pinConfig.data_out_num =
    I2S_PIN_NO_CHANGE;

  pinConfig.data_in_num =
    I2S_SD;

  esp_err_t result =
    i2s_driver_install(
      I2S_PORT,
      &config,
      0,
      nullptr
    );

  if (result != ESP_OK) {
    Serial.print(
      "{\"status\":\"error\","
      "\"stage\":\"i2s_driver_install\","
      "\"code\":"
    );

    Serial.print(
      static_cast<int>(result)
    );

    Serial.println("}");

    return false;
  }

  result =
    i2s_set_pin(
      I2S_PORT,
      &pinConfig
    );

  if (result != ESP_OK) {
    Serial.print(
      "{\"status\":\"error\","
      "\"stage\":\"i2s_set_pin\","
      "\"code\":"
    );

    Serial.print(
      static_cast<int>(result)
    );

    Serial.println("}");

    i2s_driver_uninstall(
      I2S_PORT
    );

    return false;
  }

  i2s_zero_dma_buffer(
    I2S_PORT
  );

  return true;
}

// =====================================================
// Arduino 初始化
// =====================================================
void setup() {
  Serial.begin(
    SERIAL_BAUD_RATE
  );

  delay(1000);

  setupTft();

  // 当前按钮已确认按下为 LOW，
  // 因此使用内部上拉。
  pinMode(
    BUTTON_PIN,
    INPUT_PULLUP
  );

  stableButtonState =
    digitalRead(BUTTON_PIN);

  lastButtonReading =
    stableButtonState;

  lastButtonChangeTime =
    millis();

  if (!setupI2S()) {
    showTftState(TFT_STATE_ERROR);
    while (true) {
      delay(1000);
    }
  }

  lastMetricsTime =
    millis();

  Serial.println(
    "{\"status\":\"ready\","
    "\"pcm\":true,"
    "\"rate\":16000,"
    "\"frame_samples\":512,"
    "\"button\":true,"
    "\"button_pin\":25,"
    "\"tft\":true,"
    "\"tft_driver\":\"ST7735\"}"
  );
}

// =====================================================
// Arduino 主循环
// =====================================================
void loop() {
  pollSerial();
  pollButton();
  pollTftTimeouts();
  pollRecordingTimeout();

  bool recordingAtReadStart =
    recording;

  int sampleCount =
    readPcmFrame();

  // 读取一帧约需 32ms，
  // 结束后再次检查命令和按钮。
  pollSerial();
  pollButton();
  pollTftTimeouts();
  pollRecordingTimeout();

  if (sampleCount <= 0) {
    delay(1);
    return;
  }

  // 超时已停录则不再发包
  if (!recording) {
    unsigned long currentTime = millis();
    if (
      currentTime - lastMetricsTime >=
        METRICS_INTERVAL_MS
    ) {
      lastMetricsTime = currentTime;
      printMetrics(sampleCount);
    }
    return;
  }

  // 只有整帧读取期间都处于录音状态，
  // 才发送这一帧 PCM。
  if (
    recordingAtReadStart &&
    recording
  ) {
    sendPcmFrame(
      sampleCount
    );
    // 用同一帧 INMP441 PCM 刷新 TFT 频谱（节流，不挡串口）
    updateSpectrumDisplay(
      pcmBuffer,
      sampleCount
    );
    return;
  }

  // 读取期间刚开始录音，
  // 当前帧丢弃不发包，但仍可画频谱确认有输入。
  updateSpectrumDisplay(
    pcmBuffer,
    sampleCount
  );
}
