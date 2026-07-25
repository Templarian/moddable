# Test Storage App

## Run

```sh
cd $MODDABLE/examples/teststorage
mcconfig -d -m -p esp32
```

Replace `esp32/nodemcu` with your board's platform identifier (see [ESP32_START.MD](ESP32_START.MD)). Before building, create `examples/teststorage/wifi.js` (git-ignored) with your Wi-Fi credentials:

```js
export const WIFI_NAME = "your-ssid";
export const WIFI_PASS = "your-password";
```

App should live in `examples/teststorage/` folder.

ESP32 Application, see config below.

Using the display `ls013b4dn04` with poco drawing library.

## Wifi

The app connects to Wi-Fi at startup using `WIFI_NAME`/`WIFI_PASS` imported from `wifi.js`. Once connected:

- Syncs the clock over SNTP (required for TLS certificate validation).
- Downloads the JSON at `DATA_URL` over HTTPS.
- Pressing the button (`BUTTON_PIN`) traces each key of the downloaded JSON object to the console individually.

The display shows an uptime counter (increments every second, so we know the app is running) and how long the Wi-Fi connection took (ms), both drawn with Poco.

## Manifest

```json
{
	"include": [
		"$(MODDABLE)/examples/manifest_base.json",
		"$(MODULES)/base/worker/manifest.json",
		"$(MODDABLE)/examples/manifest_commodetto.json",
		"$(MODDABLE)/examples/manifest_net.json",
		"$(MODDABLE)/modules/network/wifi/manifest.json",
		"$(MODULES)/crypt/tls.json",
		"$(MODULES)/network/http/manifest.json",
		"$(MODULES)/drivers/ls013b4dn04/manifest.json",
		"$(MODULES)/pins/digital/manifest.json",
		"$(MODULES)/pins/i2c/manifest.json",
		"$(MODULES)/drivers/mcp230xx/manifest.json"
	],
	"modules": {
		"Resource": "$(MODDABLE)/modules/files/resource/Resource",
		"commodetto/parseBMF": "$(COMMODETTO)/commodettoParseBMF",
		"commodetto/parseBMP": "$(COMMODETTO)/commodettoParseBMP",
		"commodetto/parseRLE": "$(COMMODETTO)/commodettoParseRLE",
		"commodetto/Bitmap": "$(COMMODETTO)/commodettoBitmap",
		"commodetto/Poco": "$(COMMODETTO)/commodettoPoco",
		"commodetto/*": "$(COMMODETTO)/commodettoPocoBlit",
		"commodetto/cfe": "$(COMMODETTO)/cfeBMF",
		"*": [
			"./main"
		]
	},
	"config": {
		"screen": "ls013b4dn04",
		"touch": "",
		"format": "Gray256",
		"sntp": "pool.ntp.org"
	},
	"resources": {
		"*-mask": [
			"$(MODDABLE)/examples/assets/fonts/myFont"
		],
		"*": [
			"$(MODULES)/crypt/data/ca109"
		]
	},
	"defines": {
		"ls013b4dn04": {
			"width": 400,
			"height": 240,
			"cs_pin": 4,
			"spi_port": "HSPI_HOST"
		},
	},
	"preload": [
		"Resource",
		"main"
	]
}
```
