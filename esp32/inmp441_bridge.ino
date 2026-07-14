#include <Arduino.h>
#include <driver/i2s.h>
#include <string.h>

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
char commandBuffer[32];
size_t commandLength = 0;

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
    lastMetricsTime = millis();

    return;
  }

  // 先停止继续发送 PCM
  recording = false;

  // 等待已进入串口缓冲区的 PCM 发完
  Serial.flush();

  // 再发送停止事件
  sendRecordingEvent(false, source);
  Serial.flush();

  lastMetricsTime = millis();
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
    "\"button_pin\":25}"
  );
}

// =====================================================
// Arduino 主循环
// =====================================================
void loop() {
  pollSerial();
  pollButton();

  bool recordingAtReadStart =
    recording;

  int sampleCount =
    readPcmFrame();

  // 读取一帧约需 32ms，
  // 结束后再次检查命令和按钮。
  pollSerial();
  pollButton();

  if (sampleCount <= 0) {
    delay(1);
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

    return;
  }

  // 读取期间刚开始录音，
  // 当前帧丢弃，从下一帧开始发送。
  if (recording) {
    return;
  }

  unsigned long currentTime =
    millis();

  if (
    currentTime - lastMetricsTime >=
      METRICS_INTERVAL_MS
  ) {
    lastMetricsTime =
      currentTime;

    printMetrics(
      sampleCount
    );
  }
}
