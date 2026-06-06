# ESP32 Project Setup Guide

A step-by-step guide for creating a Moddable SDK project targeting ESP32 with the LS013B4DN04 Sharp memory display and Poco graphics.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Install the Moddable SDK](#step-1-install-the-moddable-sdk)
- [Step 2: Install ESP32 Tools](#step-2-install-esp32-tools)
  - [Windows](#windows)
  - [macOS](#macos)
  - [Linux](#linux)
- [Step 3: Create Your Project](#step-3-create-your-project)
- [Step 4: Write the Manifest](#step-4-write-the-manifest)
- [Step 5: Write Your Application](#step-5-write-your-application)
- [Step 6: Build and Flash](#step-6-build-and-flash)
- [Step 7: Debug with xsbug](#step-7-debug-with-xsbug)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Git
- A supported host OS: Windows 10/11, macOS Sierra (10.12) or later, or Ubuntu Linux
- An ESP32 development board
- A USB data cable (not power-only)

---

## Step 1: Install the Moddable SDK

The Moddable SDK must be installed before installing any platform-specific tools.

1. Clone the Moddable SDK repository to a `Projects` directory in your home folder:

    ```sh
    # macOS / Linux
    cd ~/Projects
    git clone https://github.com/Moddable-OpenSource/moddable

    # Windows (Command Prompt)
    cd %USERPROFILE%\Projects
    git clone https://github.com/Moddable-OpenSource/moddable
    ```

2. Set the `MODDABLE` environment variable to point at the cloned repository:

    ```sh
    # macOS / Linux — add to ~/.zshrc or ~/.profile
    export MODDABLE=~/Projects/moddable

    # Windows — set as a User environment variable in System Settings
    # Variable name:  MODDABLE
    # Variable value: C:\Users\<username>\Projects\moddable
    ```

3. Build the Moddable SDK tools. Follow the full instructions in the [Getting Started document](documentation/Moddable%20SDK%20-%20Getting%20Started.md) for your OS.

4. Verify the tools by running the `helloworld` example in the desktop simulator:

    ```sh
    cd $MODDABLE/examples/helloworld
    mcconfig -d -m
    ```

---

## Step 2: Install ESP32 Tools

The Moddable SDK for ESP32 uses **ESP-IDF v6.0**. Follow the instructions for your host OS.

### Windows

1. Download and install the Silicon Labs [CP210x USB to UART VCP driver](https://www.silabs.com/products/development-tools/software/usb-to-uart-bridge-vcp-drivers). Use the x64 installer for 64-bit Windows.

2. Download and run the [ESP-IDF Windows Installer](https://dl.espressif.com/dl/esp-idf/?idf=6.0). Accept all defaults. When prompted, choose the **v6.0 (release version)** and clone the ESP-IDF into `%USERPROFILE%\esp32\esp-idf`.

3. Open **Environment Variables** in System Settings and create a User variable:
    - **Name:** `IDF_PATH`
    - **Value:** `C:\Users\<username>\esp32\esp-idf`

4. Open a new **"ESP-IDF 6.0 CMD"** command prompt (installed by the ESP-IDF installer) and also initialize the Visual Studio x86 environment:

    ```bat
    "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars32.bat"
    ```

5. Verify by building `helloworld` for your target:

    ```bat
    cd %MODDABLE%\examples\helloworld
    mcconfig -d -m -p esp32/nodemcu
    ```

### macOS

1. For macOS 10.15 (Catalina) or earlier, install the Silicon Labs [CP210x USB to UART VCP driver](https://www.silabs.com/products/development-tools/software/usb-to-uart-bridge-vcp-drivers). macOS Big Sur (10.16) and later do not require this driver.

2. Create the `~/esp32` directory and clone ESP-IDF v6.0:

    ```sh
    mkdir ~/esp32
    cd ~/esp32
    git clone -b v6.0 --recursive https://github.com/espressif/esp-idf.git esp-idf-v6.0
    ```

3. Install required tools (optional, update as needed):

    ```sh
    brew update
    brew install python3 cmake ninja dfu-util
    pip install pyserial
    ```

4. Add `IDF_PATH` to your shell startup file (`~/.zshrc` for Catalina and later, `~/.profile` for older):

    ```sh
    export IDF_PATH=$HOME/esp32/esp-idf-v6.0
    ```

5. Run the ESP-IDF install script:

    ```sh
    cd $IDF_PATH
    ./install.sh
    ```

6. Source the ESP-IDF environment (**required every time you open a new shell**):

    ```sh
    source $IDF_PATH/export.sh
    ```

7. Verify by building `helloworld`:

    ```sh
    cd $MODDABLE/examples/helloworld
    mcconfig -d -m -p esp32/nodemcu
    ```

### Linux

1. Install required packages (Ubuntu 20.04 or newer):

    ```sh
    sudo apt-get update
    sudo apt-get install git wget flex bison gperf python-is-python3 python3-pip \
      python3-serial cmake ninja-build ccache libffi-dev libssl-dev dfu-util
    ```

2. Create the `~/esp32` directory and clone ESP-IDF v6.0:

    ```sh
    mkdir ~/esp32
    cd ~/esp32
    git clone -b v6.0 --recursive https://github.com/espressif/esp-idf.git esp-idf-v6.0
    ```

3. Add `IDF_PATH` to your shell startup file (e.g. `~/.bash_profile` or `~/.zshrc`):

    ```sh
    export IDF_PATH=$HOME/esp32/esp-idf-v6.0
    ```

4. Run the ESP-IDF install script:

    ```sh
    cd $IDF_PATH
    sh ./install.sh
    ```

5. Source the ESP-IDF environment (**required every time you open a new shell**):

    ```sh
    source $IDF_PATH/export.sh
    ```

6. Add your user to the `dialout` group to allow serial port access, then reboot:

    ```sh
    sudo adduser $USER dialout
    sudo reboot
    ```

7. Verify by building `helloworld`:

    ```sh
    cd $MODDABLE/examples/helloworld
    mcconfig -d -m -p esp32/nodemcu
    ```

---

## Step 3: Create Your Project

Create a dedicated directory for your project. A clean project layout looks like this:

```
my-project/
├── manifest.json       # Build configuration and module declarations
├── main.js             # Application entry point
├── assets/             # Optional: images, fonts, audio files
│   ├── images/
│   └── fonts/
└── modules/            # Optional: local reusable modules
    └── myModule.js
```

Create the directory and files:

```sh
mkdir my-project
cd my-project
touch manifest.json main.js
```

> **Tip:** The `mcconfig` tool automatically looks for `manifest.json` in the current directory when no manifest path is provided.

---

## Step 4: Write the Manifest

The manifest (`manifest.json`) is a JSON file that describes every module, resource, configuration value, and hardware definition required to build your application. Below is a complete, annotated example for the LS013B4DN04 display with Poco graphics.

```json
{
    "include": [
        // Provides base runtime modules: resources, instrumentation, timers.
        // Also sets up build paths ($(MODULES), $(COMMODETTO), etc.) used below.
        "$(MODDABLE)/examples/manifest_base.json",

        // Provides Poco/Commodetto rendering modules and the ESP32 display setup.
        // Required for any project that draws graphics with Poco.
        "$(MODDABLE)/examples/manifest_commodetto.json",

        // Pulls in the LS013B4DN04 SPI driver, including its digital and SPI
        // pin dependencies for ESP32.
        "$(MODULES)/drivers/ls013b4dn04/manifest.json"
    ],

    "modules": {
        // The "*" key is a wildcard that maps module names to file paths.
        // "./main" compiles main.js from the project root.
        // Add additional local modules here as needed.
        "*": "./main"
    },

    "config": {
        // Tells the Commodetto/Poco setup module which display driver to load.
        // Must match the module name exported by the driver.
        "screen": "ls013b4dn04",

        // Touch driver name. Empty string disables touch (LS013B4DN04 has none).
        "touch": "",

        // Pixel format used for rendering. The LS013B4DN04 requires 8-bit gray
        // pixels. "Gray256" matches the -f gray256 build flag.
        "format": "Gray256"
    },

    "defines": {
        // Hardware configuration for the LS013B4DN04 display.
        // These values are compiled into the C driver via #define.
        "ls013b4dn04": {
            // Display resolution in pixels.
            "width": 400,
            "height": 240,

            // GPIO pin connected to the display's chip-select (CS) line.
            "cs_pin": 4,

            // SPI peripheral to use. "HSPI_HOST" is the standard SPI2 bus on ESP32.
            // Use "VSPI_HOST" for SPI3 if your wiring requires it.
            "spi_port": "HSPI_HOST"
        },

        // SPI bus pin assignments. Must match your physical wiring.
        // These are shared by any peripheral using the same SPI bus.
        "spi": {
            "miso_pin": 21,    // Master In Slave Out
            "mosi_pin": 19,    // Master Out Slave In
            "sck_pin": 5       // Serial Clock
        },

        // Audio output configuration via I2S.
        // Remove this section if your project does not use audio.
        "audioOut": {
            "bitsPerSample": 16,   // Audio bit depth
            "numChannels": 1,      // 1 = mono, 2 = stereo
            "sampleRate": 44100,   // Samples per second (Hz)
            "volume_divider": 1,   // Volume scaling factor (1 = no scaling)
            "i2s": {
                "bitsPerSample": 16,   // I2S bit depth (matches audioOut)
                "bck_pin": 13,         // Bit Clock pin
                "dataout_pin": 27,     // Serial Data Out pin
                "lr_pin": 12           // Left/Right (Word Select) pin
            }
        }
    }
}
```

### Key manifest sections at a glance

| Section | Purpose |
|---|---|
| `include` | Pull in other manifests (base runtime, graphics, drivers). Processed depth-first; later entries take precedence. |
| `modules` | Declare which `.js` (and `.c`) files to compile into the build. |
| `config` | Runtime-accessible values read by setup modules (screen driver, format, rotation, Wi-Fi credentials, etc.). |
| `defines` | C preprocessor `#define` values used by native drivers. Override driver defaults here. |
| `resources` | Image (PNG/JPEG/GIF) and font files to include as flash resources. |
| `preload` | Modules to execute at build time and freeze into read-only XS VM memory. |
| `platforms` | Platform-specific overrides (different modules or defines per target). |
| `build` | Environment variable definitions used to construct paths in the manifest. |
| `creation` | XS virtual machine memory allocation parameters. |

---

## Step 5: Write Your Application

`main.js` is the application entry point. The following example uses Poco to draw on the LS013B4DN04 display:

```js
import Poco from "commodetto/Poco";

const poco = new Poco(screen, { displayListLength: 4096 });

const white = poco.makeColor(255, 255, 255);
const black = poco.makeColor(0, 0, 0);
const gray  = poco.makeColor(128, 128, 128);

poco.begin();

    // Fill the entire display with white
    poco.fillRectangle(white, 0, 0, poco.width, poco.height);

    // Draw a dark gray rectangle in the center
    poco.fillRectangle(gray, 50, 50, poco.width - 100, poco.height - 100);

    // Draw a black border rectangle
    poco.blendRectangle(black, 255, 10, 10, poco.width - 20, poco.height - 20);

poco.end();
```

> **Note:** The LS013B4DN04 driver updates full scan lines only. When calling `poco.begin()`, the `x` parameter must be `0` and the `width` parameter must equal `poco.width`. Piu handles this automatically; direct Poco usage requires it explicitly.

---

## Step 6: Build and Flash

Connect your ESP32 to your computer via USB, then run `mcconfig` from your project directory.

**Debug build** (connects to xsbug debugger):

```sh
cd ~/Projects/my-project
mcconfig -d -m -p esp32/nodemcu
```

**Release build** (no debugger, smaller binary):

```sh
mcconfig -m -p esp32/nodemcu
```

Replace `esp32/nodemcu` with the platform identifier for your specific board. Common identifiers:

| Board | Platform identifier |
|---|---|
| Generic Node MCU ESP32 | `esp32/nodemcu` |
| Moddable Two | `esp32/moddable_two` |
| Moddable Six (ESP32-S3) | `esp32/moddable_six` |
| M5Stack Core | `esp32/m5stack` |
| SparkFun Thing Plus | `esp32/esp32_thing_plus` |
| Custom / bare module | `esp32` |

### Build flags reference

| Flag | Description |
|---|---|
| `-d` | Debug build — enables xsbug connection |
| `-i` | Instrumented build — ESP-IDF logging enabled, GDB stub present |
| `-m` | Run `make` automatically after generating the makefile |
| `-p <platform>` | Target platform identifier |
| `-f <format>` | Pixel format override (`gray256`, `rgb565le`, `rgb565be`, etc.) — `config.format` in the manifest is the preferred approach |
| `-r <degrees>` | Screen rotation: `0`, `90`, `180`, or `270` |
| `-t clean` | Remove all build output for the project |

### Setting the upload port manually

If `mcconfig` cannot detect your device automatically, set the `UPLOAD_PORT` environment variable:

```sh
# macOS / Linux
export UPLOAD_PORT=/dev/cu.SLAB_USBtoUART   # macOS
export UPLOAD_PORT=/dev/ttyUSB0             # Linux

# Windows
set UPLOAD_PORT=COM3
```

---

## Step 7: Debug with xsbug

1. Launch **xsbug** before running a debug build. On macOS/Linux it is at `$MODDABLE/build/bin/<platform>/debug/xsbug`. On Windows, use the Start Menu shortcut installed by the Moddable SDK tools build.

2. Run your debug build:

    ```sh
    mcconfig -d -m -p esp32/nodemcu
    ```

3. xsbug connects automatically over serial when the device boots. You can then:
    - Set breakpoints in your JavaScript source
    - Inspect variables and the call stack
    - Watch real-time memory and performance instrumentation

---

## Troubleshooting

### Device not entering bootloader mode

If flashing stalls with `Timed out waiting for packet header`, manually enter bootloader mode:
1. Unplug the device.
2. Hold the **BOOT** button.
3. Plug in the USB cable.
4. Run the `mcconfig` command.
5. Release **BOOT** after a few seconds.

### Slow builds on Windows

Windows Defender real-time scanning significantly slows ESP-IDF builds. Re-run the ESP-IDF Windows Installer and ensure the Microsoft Defender exclusions option is selected, or manually add exclusion rules for `%MODDABLE%\build` and your ESP-IDF tools directories.

### `gray256 pixels required` build error

The LS013B4DN04 driver requires 8-bit gray pixels. Ensure `"format": "Gray256"` is present in the `config` section of your manifest, or pass `-f gray256` on the `mcconfig` command line.

### Serial port permission denied (Linux)

```sh
sudo adduser $USER dialout
sudo reboot
```

### Incompatible baud rate warning

The warning `baud rate 921600 may not work` is harmless in most cases. If uploads fail midway, lower the upload speed by setting the environment variable:

```sh
export UPLOAD_SPEED=115200
```

---

## Further Reading

- [Manifest documentation](documentation/tools/manifest.md) — full reference for all manifest properties
- [LS013B4DN04 driver documentation](documentation/drivers/ls013b4dn04/ls013b4dn04.md)
- [Poco renderer documentation](documentation/commodetto/poco.md)
- [Commodetto documentation](documentation/commodetto/commodetto.md)
- [ESP32 device documentation](documentation/devices/esp32.md)
- [xsbug debugger documentation](documentation/xs/xsbug.md)
- [Tools documentation](documentation/tools/tools.md)
