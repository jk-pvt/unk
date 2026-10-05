// Minimal ST7735 wiring test for NUCLEO-F446RE.
// TFT: CS D10, RESET D3, A0/DC D6, SDA/MOSI D11, SCK D13.
// Cycles red, green, blue, and white without any external display library.

constexpr uint8_t TFT_CS = D10;
constexpr uint8_t TFT_RST = D3;
constexpr uint8_t TFT_DC = D6;
constexpr uint8_t TFT_MOSI = D11;
constexpr uint8_t TFT_SCK = D13;

void spiByte(uint8_t value) {
  for (uint8_t mask = 0x80; mask; mask >>= 1) {
    digitalWrite(TFT_MOSI, value & mask ? HIGH : LOW);
    digitalWrite(TFT_SCK, HIGH);
    digitalWrite(TFT_SCK, LOW);
  }
}

void command(uint8_t value) {
  digitalWrite(TFT_DC, LOW);
  digitalWrite(TFT_CS, LOW);
  spiByte(value);
  digitalWrite(TFT_CS, HIGH);
}

void data(uint8_t value) {
  digitalWrite(TFT_DC, HIGH);
  digitalWrite(TFT_CS, LOW);
  spiByte(value);
  digitalWrite(TFT_CS, HIGH);
}

void addressWindow(uint8_t x0, uint8_t y0, uint8_t x1, uint8_t y1) {
  command(0x2A);
  data(0); data(x0); data(0); data(x1);
  command(0x2B);
  data(0); data(y0); data(0); data(y1);
  command(0x2C);
}

void fillScreen(uint16_t color) {
  addressWindow(0, 0, 159, 127);
  digitalWrite(TFT_DC, HIGH);
  digitalWrite(TFT_CS, LOW);
  for (uint32_t i = 0; i < 160UL * 128UL; ++i) {
    spiByte(color >> 8);
    spiByte(color & 0xFF);
  }
  digitalWrite(TFT_CS, HIGH);
}

void setup() {
  Serial.begin(115200);
  pinMode(TFT_CS, OUTPUT);
  pinMode(TFT_RST, OUTPUT);
  pinMode(TFT_DC, OUTPUT);
  pinMode(TFT_MOSI, OUTPUT);
  pinMode(TFT_SCK, OUTPUT);
  digitalWrite(TFT_CS, HIGH);
  digitalWrite(TFT_SCK, LOW);

  digitalWrite(TFT_RST, HIGH);
  delay(50);
  digitalWrite(TFT_RST, LOW);
  delay(50);
  digitalWrite(TFT_RST, HIGH);
  delay(150);

  command(0x01); // Software reset
  delay(150);
  command(0x11); // Sleep out
  delay(500);
  command(0x3A); // 16-bit RGB565
  data(0x05);
  command(0x36); // Landscape orientation
  data(0x60);
  command(0x29); // Display on
  delay(100);
  Serial.println("TFT test started");
}

void loop() {
  static const uint16_t colors[] = {0xF800, 0x07E0, 0x001F, 0xFFFF};
  static const char *names[] = {"RED", "GREEN", "BLUE", "WHITE"};
  for (uint8_t i = 0; i < 4; ++i) {
    fillScreen(colors[i]);
    Serial.println(names[i]);
    delay(1000);
  }
}
