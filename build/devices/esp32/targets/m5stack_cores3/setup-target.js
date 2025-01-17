/*
 * Copyright (c) 2023 Shinya Ishikawa
 *
 *   This file is part of the Moddable SDK Runtime.
 *
 *   The Moddable SDK Runtime is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   The Moddable SDK Runtime is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 *
 *   You should have received a copy of the GNU Lesser General Public License
 *   along with the Moddable SDK Runtime.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

import Resource from "Resource";
import config from "mc/config";
import Timer from "timer";

import AXP2101 from "embedded:peripheral/Power/axp2101";
import AudioOut from "embedded:io/audioout";

const state = {
  handleRotation: nop,
};

globalThis.Host = {
  Backlight: class {
    constructor(brightness = 100) {
      this.write(brightness);
    }
    write(value) {
      if (undefined !== globalThis.power) globalThis.power.brightness = value;
    }
    close() {}
  },
};

class M5CoreS3Button {
  // M5StackCoreTouch calls write when button changes
  #value = 0;
  read() {
    return this.#value;
  }
  write(value) {
    if (this.#value === value) return;
    this.#value = value;
    this.onChanged?.();
  }
}

export default function (done) {
  // buttons
  if (config.virtualButton) {
    globalThis.button = {
      a: new M5CoreS3Button(),
      b: new M5CoreS3Button(),
      c: new M5CoreS3Button(),
    };
  }

  // power
  globalThis.power = new Power({sensor: { ...device.I2C.internal, io: device.io.SMBus }});
  globalThis.amp = new AW88298({sensor: { ...device.I2C.internal, io: device.io.SMBus }});

  // start-up sound
  if (config.startupSound) {
	const buf = new Resource(config.startupSound);
	let playing = new Uint8Array(buf, 0, buf.byteLength);
	playing.position = 0;
    const speaker = new AudioOut({
		onWritable(size) {
			do {
				let use = playing.byteLength - playing.position;
				if (use) {
					if (use > size) use = size;
					this.write(playing.subarray(playing.position, playing.position + use));
					playing.position += use;
				}
				if (playing.position === playing.byteLength) {
      this.stop();
      this.close();
      Timer.set(this.done);
					break;
				}
				size -= use;
			} while (size);
		}
	});
    speaker.done = done;
    done = undefined;
    speaker.start();
  }

  done?.();
}

/**
 * AW88298 amplifier IC
 */
class AW88298 {
	#io;
  #rateTable;
  #sampleRate;

  constructor(options) {
	const io = this.#io = new options.sensor.io ({
		hz: 400_000,
		address: 0x36,
		...options.sensor
	});

    this.#rateTable = [4, 5, 6, 8, 10, 11, 15, 20, 22, 44];
    io.writeUint16(0x05, 0x0008, true); // RMSE=0 HAGCE=0 HDCCE=0 HMUTE=0
    io.writeUint16(0x61, 0x0673, true); // boost mode disabled
    io.writeUint16(0x04, 0x4040, true); // I2SEN=1 AMPPD=0 PWDN=0
    this.volume = 250;
    this.sampleRate = 24000;
  }

  /**
   * @note with ESP-IDF, 11025Hz and its multiples are not available for the slight gap between the clock of ESP32S3 and AW88298 PLL
   * @fixme should reset sampleRate if the different value specified in AudioOut#constructor
   */
  set sampleRate(sampleRate) {
    if (this.#sampleRate === sampleRate) {
      return;
    }
    this.#sampleRate = sampleRate;
    let rateData = 0;
    let rate = Math.round((sampleRate + 1102) / 2205);
    while (
      rate > this.#rateTable[rateData] &&
      ++rateData < this.#rateTable.length
    );
    rateData |= 0x14c0; // I2SRXEN=1 CHSEL=01(left) I2SFS=11(32bits)
    this.#io.writeUint16(0x06, rateData, true);
  }

  set volume(volume) {
    const vdata = Math.round(Math.min(256, Math.max(0, volume)));
    this.#io.writeUint16(0x0c, ((256 - vdata) << 8) | 0x64, true);
  }

  get volume() {
    const vdata = this.readByte(0x0c);
    return 256 - vdata;
  }
}

class Power {	// extends AXP2101 {
	#axp2101;

	constructor(options) {
		const axp2101 = this.#axp2101 = new AXP2101({ address:0x34, ...options });
		axp2101.writeByte(0x90, 0xbf);
    	axp2101.writeByte(0x92, 13);
		axp2101.writeByte(0x93, 28);
		axp2101.writeByte(0x94, 28);
		axp2101.writeByte(0x95, 28);
		axp2101.writeByte(0x27, 0);
		axp2101.writeByte(0x69, 0x11);
		axp2101.writeByte(0x10, 0x30);

    this.expander = new AW9523({ ...options });
    this.expander.writeByte(0x02, 0b00000111);
    this.expander.writeByte(0x03, 0b10000011);
    this.expander.writeByte(0x04, 0b00011000);
    this.expander.writeByte(0x05, 0b00001100);
    this.expander.writeByte(0x11, 0b00010000);
    this.expander.writeByte(0x12, 0b11111111);
    this.expander.writeByte(0x13, 0b11111111);

    this.resetLcd();
  }

  resetLcd() {
    this.expander.writeByteMask(0x03, 0, 0b11011111);
    Timer.delay(20);
    this.expander.writeByteMask(0x03, 0b00100000, 0xff);
  }

}

/**
 * AW9523 Expander IC
 */
class AW9523 {
	#io;

  constructor(options) {
	this.#io = new options.sensor.io ({
		hz: 400_000,
		address: 0x58,
		...options.sensor
	});
  }

  writeByteMask(address, data, mask) {
    const tmp = this.#io.readUint8(address);
    const newData = (tmp & mask) | data;
    this.#io.writeUint8(address, newData);
  }
	writeByte(address, data) {
		this.#io.writeUint8(address, data);
  }
}

function nop() {}
