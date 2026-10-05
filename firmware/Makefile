TARGET  := aquasdr
BUILD   := build
PREFIX  := arm-none-eabi-
CC      := $(PREFIX)gcc
OBJCOPY := $(PREFIX)objcopy
SIZE    := $(PREFIX)size

FW_BUILD ?= $(shell git describe --always --dirty --abbrev=7 2>/dev/null || echo dev)
CPU     := -mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard
CFLAGS  := $(CPU) -O2 -g3 -std=gnu11 -Wall -Wextra -Wdouble-promotion -Wno-override-init \
           -ffunction-sections -fdata-sections -Isrc -DFW_BUILD=\"$(FW_BUILD)\" $(EXTRA_CFLAGS)
LDFLAGS := $(CPU) -T STM32F446RETx.ld -Wl,--gc-sections -Wl,-Map=$(BUILD)/$(TARGET).map \
           --specs=nano.specs --specs=nosys.specs
LDLIBS  := -lm

SRCS := src/startup.c src/main.c src/waveform.c src/telemetry.c src/capture.c src/adaptation.c src/control.c src/command.c
OBJS := $(SRCS:src/%.c=$(BUILD)/%.o)

# The NUCLEO's ST-LINK mounts as a USB drive; copying a .bin onto it flashes the board.
NUCLEO_DRIVE ?= /Volumes/NOD_F446RE

.PHONY: all adaptive flash flash-adaptive twin clean
all: $(BUILD)/$(TARGET).bin

# Separate output directory prevents mixing objects from the two configurations.
# Deliberately build-only: never flash implicitly.
adaptive:
	$(MAKE) BUILD=build-adaptive EXTRA_CFLAGS=-DAQUASDR_ADAPTIVE_INPUT=1 all

$(BUILD)/%.o: src/%.c src/*.h | $(BUILD)
	$(CC) $(CFLAGS) -c $< -o $@

$(BUILD)/$(TARGET).elf: $(OBJS) STM32F446RETx.ld
	$(CC) $(LDFLAGS) $(OBJS) $(LDLIBS) -o $@
	$(SIZE) $@

$(BUILD)/$(TARGET).bin: $(BUILD)/$(TARGET).elf
	$(OBJCOPY) -O binary $< $@

flash: $(BUILD)/$(TARGET).bin
	@test -d "$(NUCLEO_DRIVE)" || { echo "NUCLEO drive not found at $(NUCLEO_DRIVE) — plug in the board or set NUCLEO_DRIVE"; exit 1; }
	cp $< "$(NUCLEO_DRIVE)/"
	@echo "Copied — the ST-LINK LED flashes while it programs, then the board resets."

# Explicitly named install target prevents loading the ordinary bring-up image.
flash-adaptive: adaptive
	@test -d "$(NUCLEO_DRIVE)" || { echo "NUCLEO drive not found at $(NUCLEO_DRIVE) — plug in the board or set NUCLEO_DRIVE"; exit 1; }
	cp build-adaptive/$(TARGET).bin "$(NUCLEO_DRIVE)/"
	@echo "Adaptive image copied — output is disabled at boot."

# Host build of the pulse synthesiser, used by tests/firmware-twin.test.js.
twin: | $(BUILD)
	cc -O2 -std=c11 -Wall -Wextra -Isrc test/host_twin.c src/waveform.c -lm -o $(BUILD)/host_twin

$(BUILD):
	mkdir -p $@

clean:
	rm -rf $(BUILD)
