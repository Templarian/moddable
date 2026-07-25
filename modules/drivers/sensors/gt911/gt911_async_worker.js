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

import Worker from "worker";
import Timer from "timer";

class GT911 {
	#worker;
	#sample;
	#length;
	#onError;
	#onSample;

	constructor(options) {
		const {sensor, interrupt, onSample, config, onError} = options;
		if (config)
			throw new Error("config not supported");

		this.#onError = onError;
		this.#onSample = onSample;
		this.#length = 2;

		const workerConfig = {
			address: sensor.address ?? 0x5D,
			hz: sensor.hz ?? 200_000,
			interruptPin: interrupt?.pin,
			length: this.#length
		};

		this.#worker = new Worker("gt911/#worker", {
			static: 8192,
			chunk: {initial: 3072, incremental: 256},
			heap: {initial: 192, incremental: 32},
			stack: 112
		});

		this.#worker.onmessage = (msg) => {
			if (!Array.isArray(msg)) {
				if (msg?.error)
					this.#onError?.(msg.error);
				return;
			}
			this.#sample = msg;
			this.#worker.postMessage(0);
			this.#onSample?.();
		};

		this.#worker.postMessage({type: "init", config: workerConfig});
	}
	close(callback) {
		if (this.#worker) {
			this.#worker.postMessage({type: "close"});
			this.#worker.close?.();
			this.#worker = undefined;
		}
		if (callback)
			Timer.set(() => callback(null));
	}
	configure(options) {
		let {length} = options;
		if (undefined !== length) {
			length = parseInt(length);
			if ((length < 1) || (length > 15))
				throw new RangeError("invalid length");
			this.#length = length;
			this.#worker?.postMessage({type: "configure", length});
		}
	}
	sample() {
		const result = this.#sample;
		this.#sample = undefined;
		return result;
	}
	get configuration() {
		return {
			interrupt: true,		// always effectively true - onSample fires when a sample is available
			length: this.#length
		};
	}
}

export default GT911;
