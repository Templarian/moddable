/*
 * Copyright (c) 2021  Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK.
 * 
 *   This work is licensed under the
 *       Creative Commons Attribution 4.0 International License.
 *   To view a copy of this license, visit
 *       <http://creativecommons.org/licenses/by/4.0>.
 *   or send a letter to Creative Commons, PO Box 1866,
 *   Mountain View, CA 94042, USA.
 *
 */

import baseDevice from "embedded:provider/builtin";
import Joycon from "embedded:sensor/Joycon";
import Timer from "timer";

// Move to helper
class Button {
	#io;
	#onPush;

	constructor(options) {
		options = {...options};
		if (options.onReadable || options.onWritable || options.onError)
			throw new Error;

		if (options.target)
			this.target = options.target;

		const Digital = options.io;
		if (options.onPush) {
			this.#onPush = options.onPush; 
			options.onReadable = () => this.#onPush();
			options.edge = Digital.Rising | Digital.Falling;
		}

		this.#io = new Digital(options);
		this.#io.pressed = options.invert ? 0 : 1;
	}
	close() {
		this.#io?.close();
		this.#io = undefined;
	}
	get pressed() {
		return (this.#io.read() === this.#io.pressed) ? 1 : 0;
	}
}

const device = {
	io: { ...baseDevice.io }
};
device.pin = {
	...baseDevice.pin,
	joystickX: 36,
	joystickY: 37,
	joystickButton: 27
};
device.Analog = {
	...baseDevice.Analog,
	joystickX: {
		io: device.io.Analog,
		pin: device.pin.joystickX
	},
	joystickY: {
		io: device.io.Analog,
		pin: device.pin.joystickY
	}
};
device.peripheral = {
	...baseDevice.peripheral,
	button: {
		Joystick: class {
			constructor(options) {
				return new Button({
					...options,
					io: device.io.Digital,
					pin: device.pin.joystickButton,
					mode: device.io.Digital.InputPullUp,
					invert: false
				});
			}
		}
	}
};

const sensor = new Joycon({
	x: device.Analog.joystickX,
	y: device.Analog.joystickY
});

// A calibration UI is recommended
sensor.configure({
	xMin: 150,
	xMax: 800,
	xCenter: 500,
	yMin: 150,
	yMax: 800,
	yCenter: 500,
	deadzone: 50
});

Timer.repeat(() => {
	// x, y = 1 to -1, 0 = center
	// xRaw, yRaw = 0 to 1023
	const { x, y, xRaw, yRaw } = sensor.sample();
	trace(`x: ${x.toFixed(2)}, y: ${y.toFixed(2)}\n`);
	trace(`- Raw X: ${xRaw}, Raw Y: ${yRaw}\n`);
}, 100); // 10ms is ideal for real world joystick usage

new device.peripheral.button.Joystick({
	onPush() {
		trace('Joystick pushed down!');
	}
});
