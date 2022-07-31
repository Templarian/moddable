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

import device from "embedded:provider/builtin";
import Joycon from "embedded:sensor/Joycon";
import Timer from "timer";

Object.assign(device.pin, {
	joystickX: 36,
	joystickY: 37,
	joystickButton: 27
});
Object.assign(device.Analog || (device.Analog = {}), {
	joystickX: {
		io: device.io.Analog,
		pin: device.pin.joystickX
	},
	joystickY: {
		io: device.io.Analog,
		pin: device.pin.joystickY
	}
});
const peripheral = device.peripheral || (device.peripheral = {});
Object.assign(peripheral || (peripheral.button = {}), {
	Joystick: class {
		constructor(options) {
			return new Button({
				...options,
				io: Digital,
				pin: device.pin.joystickButton,
				mode: Digital.InputPullUp,
				invert: true
			});
		}
	}
});

const sensor = new Joycon({
	x: device.Analog.joystickX,
	y: device.Analog.joystickY
});

// A calibration UI is recommended
sensor.configure({
	xMin: 200,
	xMax: 800,
	xCenter: 500,
	yMin: 200,
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

device.peripheral.button.Joystick({
	onPush() {
		trace('Joystick pushed down!');
	}
});
