#include <Arduino.h>
#include <driver/i2s.h>
#include <string.h>

// =====================================================
// INMP441 I2S 引脚
// =====================================================

#define I2S_SCK 14
#define I2S_WS  15
#define I2S_SD  32

#define I2S_PORT I2S_NUM_0

// =====================================================
// Keyes 按钮引脚
//
// S  -> GPIO25
// +  -> 3.3V
// -  -> GND
// =====================================================

#define BUTTON_PIN 25

// Keyes 模块接线不同时，按下可能是 HIGH 或 LOW。
// 不再写死极性：上电时的电平视为“松开”，
// 稳定变化到另一电平视为“按下”边沿。
#define BUTTON_DEBOUNCE_MS 40

// 上电时采样的松开电平（setup 里赋值）
int buttonIdleLevel = HIGH;

// =====================================================
// 音频参数
// =====================================================

#define SAMPLE_RATE   16000
#define FRAME_SAMPLES 512

// 未录音状态下输出 metrics 的时间间隔
#define METRICS_INTERVAL_MS 150

// 声音峰值判断阈值
#define SOUND_THRESHOLD 3000

// =====================================================
// 串口参数
// =====================================================

#define SERIAL_BAUD_RATE 500000

// =====================================================
// 录音状态
// =====================================================

// false：只进行声音检测，不发送 PCM
// true ：连续发送二进制 PCM
bool recording = false;

// 每次新录音从 0 开始的帧序号
uint16_t seq = 0;

// =====================================================
// I2S 和 PCM 缓冲区
// =====================================================

// INMP441 32-bit I2S 原始样本
int32_t i2sBuffer[FRAME_SAMPLES];

// 转换后的 PCM16 样本
int16_t pcmBuffer[FRAME_SAMPLES];

// =====================================================
// 按钮消抖状态
// =====================================================

// 最近一次读取到的原始电平
int lastButtonReading = HIGH;

// 经过消抖后确认的稳定电平
int stableButtonState = HIGH;

// 原始按钮电平最后一次变化的时间
unsigned long lastButtonChangeTime = 0;

// =====================================================
// metrics 输出定时
// =====================================================

unsigned long lastMetricsTime = 0;

// =====================================================
// 串口命令缓冲区
// =====================================================

char commandBuffer[32];
size_t commandLength = 0;

// =====================================================
// 将 INMP441 的 32-bit I2S 数据转换为 PCM16
//
// INMP441 的有效数据位于高位。
// 保留现有项目使用的右移 14 位缩放方式。
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
// 只能在 recording == false 时调用。
// 该 JSON 用于电脑端识别硬件开始或停止录音。
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
// enabled：
// true  = 开始发送 PCM
// false = 停止发送 PCM
//
// source：
// button   = Keyes 按钮触发
// computer = 串口命令触发
//
// 开始录音时：
// 1. 先在非录音状态输出 rec_start JSON
// 2. 等待 JSON 进入串口发送队列
// 3. 再将 recording 设置为 true
//
// 停止录音时：
// 1. 先将 recording 设置为 false
// 2. 等待已排队的 PCM 完成发送
// 3. 再输出 rec_stop JSON
// =====================================================

void setRecording(bool enabled, const char *source) {
  // 状态相同时不重复执行
  if (recording == enabled) {
    return;
  }

  if (enabled) {
    // 当前仍处于非录音状态，可以安全输出 JSON
    sendRecordingEvent(true, source);

    // 确保 JSON 先于 PCM 进入发送链路
    Serial.flush();

    // 新录音从第 0 帧开始
    seq = 0;

    // 从此处开始，串口只能输出二进制 PCM
    recording = true;

    // 防止刚开始或停止时立即输出 metrics
    lastMetricsTime = millis();

    return;
  }

  // 先退出录音状态，禁止继续产生 PCM
  recording = false;

  // 等待此前已写入串口缓冲区的 PCM 完成发送
  Serial.flush();

  // 此时已处于非录音状态，可以输出停止 JSON
  sendRecordingEvent(false, source);

  Serial.flush();

  // 停止后暂缓 metrics，避免紧贴 rec_stop
  lastMetricsTime = millis();
}

// =====================================================
// 从 INMP441 读取一帧数据并转换为 PCM16
//
// 返回：
// > 0：实际样本数量
// = 0：读取失败或未读取到数据
//
// 此函数不会向串口输出任何内容。
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
// 按指定二进制协议发送一帧 PCM16
//
// 帧格式：
// 0xA5
// 0x5A
// 0x01
// seq 低字节
// seq 高字节
// sampleCount 低字节
// sampleCount 高字节
// PCM16 数据
//
// seq 和 sampleCount 均使用小端格式。
// =====================================================

void sendPcmFrame(int sampleCount) {
  if (sampleCount <= 0) {
    return;
  }

  uint8_t header[7];

  // 固定帧头
  header[0] = 0xA5;
  header[1] = 0x5A;
  header[2] = 0x01;

  // seq：u16 little-endian
  header[3] = static_cast<uint8_t>(seq & 0xFF);
  header[4] = static_cast<uint8_t>((seq >> 8) & 0xFF);

  // sampleCount：u16 little-endian
  uint16_t count = static_cast<uint16_t>(sampleCount);

  header[5] = static_cast<uint8_t>(count & 0xFF);
  header[6] = static_cast<uint8_t>((count >> 8) & 0xFF);

  // 发送协议头
  Serial.write(header, sizeof(header));

  // ESP32 为小端架构，可直接发送 PCM16 内存数据
  Serial.write(
    reinterpret_cast<const uint8_t *>(pcmBuffer),
    sampleCount * sizeof(int16_t)
  );

  seq++;
}

// =====================================================
// 计算一帧 PCM 的平均绝对幅值和峰值
//
// 返回值：平均绝对幅值
// peakOut：该帧最大绝对幅值
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
    // 先提升至 int32_t，避免 -32768 取绝对值溢出
    int32_t value = static_cast<int32_t>(buffer[i]);

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
// 未录音时输出声音检测 metrics
//
// 录音时不会调用该函数。
// 每条信息均为一行完整 JSON。
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

  Serial.print("{\"type\":\"metrics\",\"sound\":");
  Serial.print(soundDetected ? "true" : "false");

  Serial.print(",\"volume\":");
  Serial.print(percent, 2);

  Serial.print(",\"peak\":");
  Serial.print(peak);

  Serial.print(",\"btn\":");
  Serial.print(stableButtonState);

  Serial.println("}");
}

// =====================================================
// 输出空闲状态
//
// STATUS 命令只在未录音时返回。
// 录音期间 STATUS 被静默忽略，以免污染 PCM。
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
// 处理一条完整的电脑端串口命令
//
// 支持：
// REC_START
// REC_STOP
// REC_TOGGLE
// STATUS
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
    // 录音期间禁止输出 JSON
    if (!recording) {
      sendIdleStatus();
    }

    return;
  }
}

// =====================================================
// 非阻塞读取电脑端串口命令
//
// 命令需要以 \n 或 \r 结束。
// 不使用 readStringUntil()，避免长时间阻塞音频采集。
// =====================================================

void pollSerial() {
  while (Serial.available() > 0) {
    int incoming = Serial.read();

    if (incoming < 0) {
      break;
    }

    char currentChar = static_cast<char>(incoming);

    // 换行表示一条命令结束
    if (
      currentChar == '\n' ||
      currentChar == '\r'
    ) {
      if (commandLength > 0) {
        commandBuffer[commandLength] = '\0';

        handleSerialCommand(commandBuffer);

        commandLength = 0;
      }

      continue;
    }

    // 将字符加入命令缓冲区
    if (commandLength < sizeof(commandBuffer) - 1) {
      commandBuffer[commandLength] = currentChar;
      commandLength++;
    } else {
      // 命令过长时丢弃当前命令
      commandLength = 0;
    }
  }
}

// =====================================================
// 读取 Keyes 按钮并执行约 40ms 软件消抖
//
// 上电时的电平 = 松开（idle）。
// 稳定变为另一电平 = 按下边沿 → 切换录音。
// 回到 idle = 松开，不触发。
//
// 这样无论 Keyes 是按下 HIGH 还是按下 LOW 都能用。
// =====================================================

void pollButton() {
  int reading = digitalRead(BUTTON_PIN);

  // 原始电平发生变化，重新开始消抖计时
  if (reading != lastButtonReading) {
    lastButtonReading = reading;
    lastButtonChangeTime = millis();
  }

  // 原始电平持续稳定超过消抖时间后，
  // 才确认稳定状态发生改变
  if (
    reading != stableButtonState &&
    millis() - lastButtonChangeTime >= BUTTON_DEBOUNCE_MS
  ) {
    const int previous = stableButtonState;
    stableButtonState = reading;

    // 仅在“进入按下”（离开 idle）时切换录音
    if (
      previous == buttonIdleLevel &&
      stableButtonState != buttonIdleLevel
    ) {
      if (!recording) {
        Serial.print("{\"debug\":\"button_press\",\"pin\":");
        Serial.print(BUTTON_PIN);
        Serial.print(",\"level\":");
        Serial.print(stableButtonState);
        Serial.print(",\"idle\":");
        Serial.print(buttonIdleLevel);
        Serial.println("}");
      }
      setRecording(!recording, "button");
    }
  }
}

// =====================================================
// 初始化 INMP441 I2S 接口
//
// 返回：
// true  = 初始化成功
// false = 初始化失败
// =====================================================

bool setupI2S() {
  i2s_config_t config = {};

  config.mode = static_cast<i2s_mode_t>(
    I2S_MODE_MASTER |
    I2S_MODE_RX
  );

  config.sample_rate = SAMPLE_RATE;

  config.bits_per_sample =
    I2S_BITS_PER_SAMPLE_32BIT;

  // L/R 接 GND，INMP441 输出左声道
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

  pinConfig.bck_io_num = I2S_SCK;
  pinConfig.ws_io_num = I2S_WS;
  pinConfig.data_out_num = I2S_PIN_NO_CHANGE;
  pinConfig.data_in_num = I2S_SD;

  esp_err_t result = i2s_driver_install(
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

    Serial.print(static_cast<int>(result));
    Serial.println("}");

    return false;
  }

  result = i2s_set_pin(
    I2S_PORT,
    &pinConfig
  );

  if (result != ESP_OK) {
    Serial.print(
      "{\"status\":\"error\","
      "\"stage\":\"i2s_set_pin\","
      "\"code\":"
    );

    Serial.print(static_cast<int>(result));
    Serial.println("}");

    i2s_driver_uninstall(I2S_PORT);

    return false;
  }

  i2s_zero_dma_buffer(I2S_PORT);

  return true;
}

// =====================================================
// Arduino 初始化
// =====================================================

void setup() {
  // 固件和电脑端必须统一使用 500000
  Serial.begin(SERIAL_BAUD_RATE);

  delay(1000);

  // Keyes（+→3.3V, -→GND, S→GPIO25）按下多为 HIGH。
  // 使用内部下拉，松开=LOW，按下=HIGH；idle 再自动校准一次。
  pinMode(BUTTON_PIN, INPUT_PULLDOWN);

  // 上电时按钮应处于松开；该电平作为 idle
  delay(20);
  buttonIdleLevel = digitalRead(BUTTON_PIN);
  stableButtonState = buttonIdleLevel;
  lastButtonReading = buttonIdleLevel;
  lastButtonChangeTime = millis();

  Serial.print("{\"debug\":\"button_idle\",\"pin\":");
  Serial.print(BUTTON_PIN);
  Serial.print(",\"level\":");
  Serial.print(buttonIdleLevel);
  Serial.println("}");

  // 初始化 INMP441
  if (!setupI2S()) {
    // 初始化失败后停止运行，
    // 防止继续发送无效音频数据
    while (true) {
      delay(1000);
    }
  }

  lastMetricsTime = millis();

  // setup 成功后输出一次指定 ready JSON
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
//
// 麦克风始终持续采集：
// - 未录音：只进行声音检测和 metrics 输出
// - 录音中：只输出二进制 PCM
//
// 按钮与电脑端命令共用 setRecording()。
// =====================================================

void loop() {
  // 在读取音频前检查电脑命令和按钮
  pollSerial();
  pollButton();

  // 记录开始读取该帧时的录音状态
  bool recordingAtReadStart = recording;

  // 读取一帧 512 样本音频
  int sampleCount = readPcmFrame();

  // 一帧约为 32ms。
  // 读取期间可能收到命令或按钮变化，因此再次检查。
  pollSerial();
  pollButton();

  if (sampleCount <= 0) {
    delay(1);
    return;
  }

  // 只有“开始读取该帧时已经在录音”，
  // 并且“读取结束后仍处于录音”，才发送该帧。
  //
  // 这样可避免：
  // - 开始按钮发生在读取中途时发送按下前的旧数据
  // - 停止按钮发生在读取中途时继续多发一帧
  if (recordingAtReadStart && recording) {
    sendPcmFrame(sampleCount);
    return;
  }

  // 当前仍处于录音，但该帧是在开始录音前读取的，
  // 丢弃该帧，下一轮再发送新的 PCM。
  if (recording) {
    return;
  }

  // 未录音时按固定间隔输出声音检测信息
  unsigned long currentTime = millis();

  if (
    currentTime - lastMetricsTime >=
    METRICS_INTERVAL_MS
  ) {
    lastMetricsTime = currentTime;

    printMetrics(sampleCount);
  }
}
