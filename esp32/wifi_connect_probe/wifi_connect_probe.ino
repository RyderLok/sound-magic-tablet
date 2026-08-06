/**
 * Piko · ESP32 Wi‑Fi connect probe (standalone sketch folder)
 *
 * Recommended: phone personal hotspot.
 * Flash THIS folder only (not esp32/inmp441_bridge.ino).
 * When done, open and re-flash inmp441_bridge.ino for USB recording.
 *
 * Steps:
 *   1. Phone hotspot ON (name/password in wifi_secrets.h — local, gitignored)
 *   2. Arduino → File → Open → esp32/wifi_connect_probe/wifi_connect_probe.ino
 *   3. Board: ESP32 Dev Module → Upload
 *   4. Serial Monitor @ 115200 → "WiFi OK" + IP
 */

#include <Arduino.h>
#include <WiFi.h>
#include <string.h>

#if __has_include("wifi_secrets.h")
#include "wifi_secrets.h"
#else
#warning "Missing wifi_secrets.h — copy wifi_secrets.h.example"
#define WIFI_SSID "YOUR_HOTSPOT_NAME"
#define WIFI_PASS "YOUR_HOTSPOT_PASSWORD"
#endif

static const char *AP_SSID = "Piko-ESP32";
static const char *AP_PASS = "piko1234";

static const uint32_t STA_TIMEOUT_MS = 20000;

enum NetMode { NET_NONE, NET_STA, NET_AP };
NetMode netMode = NET_NONE;

bool connectSta() {
  if (!WIFI_SSID || !WIFI_SSID[0]
      || strcmp(WIFI_SSID, "YOUR_HOTSPOT_NAME") == 0
      || strcmp(WIFI_SSID, "YOUR_WIFI_NAME") == 0) {
    Serial.println("[wifi] SSID not set — create wifi_secrets.h from example");
    return false;
  }

  Serial.printf("[wifi] STA connecting to \"%s\" …\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - t0) < STA_TIMEOUT_MS) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("[wifi] STA failed status=%d\n", (int)WiFi.status());
    return false;
  }

  netMode = NET_STA;
  Serial.println("[wifi] WiFi OK (STA)");
  Serial.print("[wifi] IP  ");
  Serial.println(WiFi.localIP());
  Serial.print("[wifi] MAC ");
  Serial.println(WiFi.macAddress());
  Serial.printf("[wifi] RSSI %d dBm\n", WiFi.RSSI());
  return true;
}

void startSoftAp() {
  Serial.println("[wifi] Starting SoftAP fallback…");
  WiFi.mode(WIFI_AP);
  bool ok = WiFi.softAP(AP_SSID, AP_PASS);
  netMode = ok ? NET_AP : NET_NONE;
  Serial.printf("[wifi] SoftAP %s\n", ok ? "OK" : "FAILED");
  Serial.printf("[wifi] Join SSID \"%s\"  pass \"%s\"\n", AP_SSID, AP_PASS);
  Serial.print("[wifi] AP IP ");
  Serial.println(WiFi.softAPIP());
}

void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println();
  Serial.println("=== Piko Wi‑Fi probe (phone hotspot) ===");
  Serial.println("Re-flash inmp441_bridge.ino when done.");

  if (!connectSta()) {
    startSoftAp();
  }
}

void loop() {
  static uint32_t last = 0;
  if (millis() - last < 5000) return;
  last = millis();

  if (netMode == NET_STA) {
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[wifi] STA lost — retrying…");
      if (!connectSta()) startSoftAp();
    } else {
      Serial.printf("[wifi] alive STA  ip=%s  rssi=%d\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
    }
  } else if (netMode == NET_AP) {
    Serial.printf("[wifi] alive AP   ip=%s  clients=%d\n",
                  WiFi.softAPIP().toString().c_str(), WiFi.softAPgetStationNum());
  } else {
    Serial.println("[wifi] no link");
  }
}
