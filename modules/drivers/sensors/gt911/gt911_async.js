/*
 * Copyright (c) 2016-2026  Moddable Tech, Inc.
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

import Timer from "timer";
import Time from "time";

const ID = Object.freeze(Uint8Array.of(0x81, 0x40).buffer);
const ADDR = Object.freeze(Uint8Array.of(0x81, 0x4E).buffer);
const NEXT = Object.freeze(Uint8Array.of(0x81, 0x4E, 0).buffer);

class GT911 {
	#io;
	#data;
	#length;
	#timer;
	#ticksQueue = [];
	#onError;
	#onSample;
	#onPoints;

	constructor(options) {
		const {sensor, interrupt, onSample, config, onError} = options;
		if (config)
			throw new Error("config not supported");

		const io = this.#io = new sensor.io.Async({
			hz: 200_000,		// data sheet warns about speeds over 200_000
			address: 0x5D,
			...sensor
		});
		this.#onError = onError;
		this.#onSample = onSample;
		this.#length = 2;
		this.#data = new Uint8Array(1 + (2 << 3));

		if (interrupt && onSample) {
			io.interrupt = new interrupt.io({
				...interrupt,
				edge: interrupt.io.Rising,
				onReadable: () => this.#doSample()
			});
		}

		this.#onPoints = (error) => {
			const ticks = this.#ticksQueue.shift();		// matched with this completion's #doSample

			if (error)
				return void this.#onError?.(error);

			const io = this.#io, data = this.#data;
			io.write(NEXT);		// ready chip for next reading

			const status = data[0];
			if (!(0x80 & status)) {		// not ready - wait for next
				if (this.#timer)
					Timer.schedule(this.#timer, 33, 33);
				return;
			}

			const touchCount = Math.min(status & 0b0000_1111, this.#length);
			if (0 === touchCount) {
				if (this.#timer)
					Timer.schedule(this.#timer, 50, 50);
				if (io.none)
					return;
				io.none = true;
				const sample = [];
				sample.ticks = ticks;
				io.sample = sample;
				this.#onSample?.();
				return;
			}
			delete io.none;

			const result = new Array(touchCount);
			result.ticks = ticks;
			for (let i = 0; i < touchCount; i++) {
				const offset = i * 8 + 1;
				const id = data[offset];
				const x = data[offset + 1] | (data[offset + 2] << 8);
				const y = data[offset + 3] | (data[offset + 4] << 8);
				const size = data[offset + 5] | (data[offset + 6] << 8);
				result[i] = {x, y, id, size};
			}
			io.sample = result;

			if (this.#timer)
				Timer.schedule(this.#timer, 17, 17);		// higher polling frequency while touch active

			this.#onSample?.();
		};

		io.write(ID, (error) => {
			if (error)
				return void this.#onError?.(error);
			io.read(3, (error, data) => {
				if (error)
					return void this.#onError?.(error);
				data = new Uint8Array(data);
				if ((57 !== data[0]) || (49 !== data[1]) || (49 !== data[2]))
					return void this.#onError?.("unrecognized");
				io.write(NEXT);		// ready chip for next reading
				if (!io.interrupt)
					this.#timer = Timer.set(() => this.#doSample(), 0, 33);
			});
		});
	}
	close(callback) {
		this.#io?.interrupt?.close();
		this.#io?.close(error => callback?.(error));
		this.#io = undefined;
		Timer.clear(this.#timer);
		this.#timer = undefined;
	}
	configure(options) {
		let {length} = options;
		if (undefined !== length) {
			length = parseInt(length);
			if ((length < 1) || (length > 15))
				throw new RangeError("invalid length");
			this.#length = length;
			this.#data = new Uint8Array(1 + (length << 3));
		}
	}
	sample() {
		const result = this.#io.sample;
		delete this.#io.sample;
		return result;
	}
	#doSample() {
		this.#ticksQueue.push(Time.ticks);		// pair this transaction's ticks with its completion
		if (this.#timer)
			Timer.schedule(this.#timer);
		this.#io.writeRead(ADDR, this.#data, this.#onPoints);
	}
	get configuration() {
		return {
			interrupt: true,		// always effectively true - onSample will be called when sample is available
			length: this.#length
		};
	}
}

export default GT911;
