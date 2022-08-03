/*
 * Copyright (c) 2021  Moddable Tech, Inc.
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

class Joycon {
	#x;
	#y;
	#xMin;
	#xMax;
	#xCenter;
	#yMin;
	#yMax;
	#yCenter;
	#deadzone;

	constructor(options) {
		this.#x = new options.x.io(options.x);
		this.#y = new options.y.io(options.y);
		this.#xMin = 150;
		this.#xMax = 800;
		this.#xCenter = 500;
		this.#yMin = 150;
		this.#yMin = 800;
		this.#yCenter = 500;
		this.#deadzone = 50;
	}
	configure(options) {
		if (options.xMin !== undefined)
			this.#xMin = options.xMin;
		if (options.xMax !== undefined)
			this.#xMax = options.xMax;
		if (options.xCenter !== undefined)
			this.#xCenter = options.xCenter;
		if (options.yMin !== undefined)
			this.#yMin = options.yMin;
		if (options.yMax !== undefined)
			this.#yMax = options.yMax;
		if (options.yCenter !== undefined)
			this.#yCenter = options.yCenter;
		if (options.deadzone !== undefined)
			this.#deadzone = options.deadzone;
	}
	close() {
		// Analog no cleanup?
	}
	sample() {
		const xRaw = this.#x.read(),
			yRaw = this.#y.read();
		// Calculate normalized x and y
		// xMin | 50 | 0 to -1 | 50 | center | 50 | 0 to 1 | 50 | xMax
		//          xMinCenter ^                  ^ xMaxCenter
		const xMinCenter = this.#xCenter - this.#deadzone,
			xMaxCenter = this.#xCenter + this.#deadzone,
			yMinCenter = this.#yCenter - this.#deadzone,
			yMaxCenter = this.#yCenter + this.#deadzone,
			xMinZone = this.#xMin + this.#deadzone,
			xMaxZone = this.#xMax - this.#deadzone,
			yMinZone = this.#yMin + this.#deadzone,
			yMaxZone = this.#yMax - this.#deadzone;
		let x = 0, y = 0;
		if (xRaw <= xMinZone)
			x = -1;
		else if (xRaw >= xMaxZone)
			x = 1;
		else if (xRaw >= xMinCenter
			&& xRaw <= xMaxCenter)
			x = 0;
		else if (xRaw < xMinCenter)
			x = -1 * (1 + ((xMinZone - xRaw) / (xMinCenter - xMinZone)));
		else
			x = 1 - ((xMaxZone - xRaw) / (xMaxZone - xMaxCenter));
		if (yRaw <= yMinZone)
			y = -1;
		else if (yRaw >= yMaxZone)
			y = 1;
		else if (yRaw >= yMinCenter
			&& yRaw <= yMaxCenter)
			y = 0;
		else if (yRaw < yMinCenter)
			y = -1 * (1 + ((yMinZone - yRaw) / (yMinCenter - yMinZone)));
		else
			y = 1 - ((yMaxZone - yRaw) / (yMaxZone - yMaxCenter));
		// x, y = -1 to 1, center 0
		// xRaw, yRaw = 0 to 1023
		return { x, y, xRaw, yRaw };
	}
}

export default Joycon;
