/*
 * Copyright (c) 2026  Moddable Tech, Inc.
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

class Alert extends Native("xs_health_alert_destructor") {
	constructor(options) { super(); native("xs_health_alert").call(this, options); }
	close() { return native("xs_health_alert_close").call(this); }

	static {
		this.prototype[Symbol.dispose] = this.prototype.close;
	}
}

class Health {
	static metric = {
		get(name) { return native("xs_health_metric_get").call(this, name); },
		query(options) { return native("xs_health_metric_query").call(this, options); },
		accessible(options) { return native("xs_health_metric_accessible").call(this, options); },
		Alert
	}

	static activity = {
		get() { return native("xs_health_activity_get").call(this); },
		iterate(options) { return native("xs_health_activity_iterate").call(this, options); },
		accessible(options) { return native("xs_health_activity_accessible").call(this, options); },

		sleep:        1 << 0,
		restfulSleep: 1 << 1,
		walk:         1 << 2,
		run:          1 << 3,
		openWorkout:  1 << 4,
	};

	static heartRate = {
		set samplePeriod(value) { native("xs_health_heartrate_set_sample_period").call(this, value); },
		get samplePeriodExpiration() { return native("xs_health_heartrate_get_expiration").call(this); },
	};

	static history = {
		byMinute(options) { return native("xs_health_history_minute").call(this, options); },
	};

	static access = {
		available:  1 << 0,
		permission: 1 << 1,
		supported:  1 << 2,
		data:       1 << 3,
	};

	static displayMeasurementSystem(metric) {
		return native("xs_health_measurement_system").call(this, metric);
	}
}

Object.freeze(Health, true);

export default Health;
