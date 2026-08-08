import LS013B4DN04 from "ls013b4dn04";
import { MCP23017 } from "MCP230XX";
import Poco from "commodetto/Poco";
import Resource from "Resource";
import parseBMP from "commodetto/parseBMP";
import parseBMF from "commodetto/parseBMF";
// import Sleep from "sleep";
import Timer from "timer";
import Digital from "pins/digital";
import I2C from "pins/i2c";
import WiFi from "wifi";
import SNTP from "sntp";
import Time from "time";
import config from "mc/config";
import { Request } from "http";
import SecureSocket from "securesocket";
import { Storage } from 'data';

import { WIFI_NAME, WIFI_PASS } from "wificreds";

const DATA_URL = 'https://gist.githubusercontent.com/Templarian/48566d3a22b8dc21dde54e251aa7d9d3/raw/fc56162bb996cb97abe8a9a2106bd2b691a4c020/testdata.json';

const BUTTON_PIN = 38;

trace("App Started\n");

function parseURL(url) {
	const match = url.match(/^https:\/\/([^/]+)(\/.*)$/);
	return { host: match[1], path: match[2] };
}

const nextId = (() => {
	let count = 0;
	return () => {
		count += 1;
		return String(count).padStart(8, '0');
	};
})();

function randomString() {
	return Math.random() > 0.5
		? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
		: '12345678';
}

class App {
	#poco;
	#white;
	#black;
	#font;
	#statusHeight;
	#seconds = 0;
	#wifiConnectMs = -1;
	#data = null;
	#button;
	#previous;

	constructor() {
		this.#poco = new Poco(screen, { displayListLength: 2048 });
		this.#white = this.#poco.makeColor(255, 255, 255);
		this.#black = this.#poco.makeColor(0, 0, 0);
		this.#font = parseBMF(new Resource("myFont.bf4"));
		this.#statusHeight = (this.#font.height * 2) + 6;

		this.#drawStatus();

		const storage = new Storage(10000);
		for (let i = 0; i < 1000; i++) {
			storage.set(nextId(), randomString());			
		}
		storage.clearCache();
		const time = new Date();
		trace(storage.get('00000001'));
		trace(new Date() - time);
		trace(storage.get('00000999'));
		trace(new Date() - time);

		Timer.repeat(() => {
			this.#seconds += 1;
			this.#drawStatus();
		}, 1000);

		this.#button = new Digital(BUTTON_PIN, Digital.InputPullUp);
		this.#previous = this.#button.read();
		Timer.repeat(() => this.#checkButton(), 100);

		this.#connectWiFi();
	}

	#drawStatus() {
		const uptimeLine = `Uptime: ${this.#seconds}`;
		const wifiLine = (this.#wifiConnectMs < 0) ? "Wi-Fi: connecting..." : `Wi-Fi: ${this.#wifiConnectMs}ms`;
		const poco = this.#poco;

		poco.begin(0, 0, poco.width, this.#statusHeight);
		poco.fillRectangle(this.#black, 0, 0, poco.width, this.#statusHeight);
		poco.drawText(uptimeLine, this.#font, this.#white, 2, 2);
		poco.drawText(wifiLine, this.#font, this.#white, 2, this.#font.height + 4);
		poco.end();
	}

	#connectWiFi() {
		const start = Date.now();

		WiFi.mode = WiFi.Mode.station;
		new WiFi({ ssid: WIFI_NAME, password: WIFI_PASS }, (msg) => {
			trace(`Wi-Fi ${msg}\n`);
			if (WiFi.gotIP === msg) {
				this.#wifiConnectMs = Date.now() - start;
				this.#drawStatus();
				this.#startClock();
			}
		});
	}

	#startClock() {
		new SNTP({ host: config.sntp }, (message, value) => {
			if (SNTP.time === message)
				Time.set(value);
			else if (SNTP.error === message)
				trace("Unable to get time from SNTP\n");

			this.#fetchData();
		});
	}

	#fetchData() {
		const { host, path } = parseURL(DATA_URL);
		const request = new Request({
			host, path, port: 443, response: String,
			Socket: SecureSocket, secure: { protocolVersion: 0x303 }
		});
		request.callback = (message, value) => {
			if (Request.responseComplete === message) {
				try {
					this.#data = JSON.parse(value);
					trace("Data downloaded\n");
				}
				catch (e) {
					trace(`JSON parse error: ${e}\n`);
				}
			}
			else if (Request.error === message)
				trace("Data download failed\n");
		};
	}

	#checkButton() {
		const current = this.#button.read();
		if ((current !== this.#previous) && !current) {
			if (this.#data) {
				const poco = this.#poco;

				poco.begin(0, 0, poco.width, poco.height);
				poco.fillRectangle(this.#black, 50, 50, 100, 100);
				poco.end();
				for (const key of Object.keys(this.#data))
					trace(`${key}\n`);
			}
			else
				trace("Data not yet available\n");
		}
		this.#previous = current;
	}
}

export default function () {
	// Fix display
	Timer.set(() => {
		Digital.write(4, 1);
	}, 10);
	// Run app
	new App;
}
