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

#include "xsmc.h"
#include "xsHost.h"
#include "mc.xs.h"			// for xsID_ values

#include "applib/health_service.h"

#define SECONDS_FROM_MS(ms)	((time_t)((ms) / 1000.0))
#define MS_FROM_SECONDS(s)	((double)(s) * 1000.0)

static HealthMetric parseMetric(xsMachine *the, xsSlot *slot)
{
	char *buf = xsmcToString(*slot);
	if (!c_strcmp(buf, "step count"))			return HealthMetricStepCount;
	if (!c_strcmp(buf, "active seconds"))		return HealthMetricActiveSeconds;
	if (!c_strcmp(buf, "walked distance"))		return HealthMetricWalkedDistanceMeters;
	if (!c_strcmp(buf, "sleep seconds"))		return HealthMetricSleepSeconds;
	if (!c_strcmp(buf, "sleep restful seconds"))	return HealthMetricSleepRestfulSeconds;
	if (!c_strcmp(buf, "resting calories"))		return HealthMetricRestingKCalories;
	if (!c_strcmp(buf, "active calories"))		return HealthMetricActiveKCalories;
	if (!c_strcmp(buf, "heart rate"))			return HealthMetricHeartRateBPM;
	if (!c_strcmp(buf, "heart rate raw"))		return HealthMetricHeartRateRawBPM;

	xsUnknownError("invalid metric");
	return HealthMetricStepCount;	// unreachable
}

static HealthAggregation parseAggregation(xsMachine *the, xsSlot *slot)
{
	char *buf = xsmcToString(*slot);
	if (!c_strcmp(buf, "sum"))		return HealthAggregationSum;
	if (!c_strcmp(buf, "average"))	return HealthAggregationAvg;
	if (!c_strcmp(buf, "min"))		return HealthAggregationMin;
	if (!c_strcmp(buf, "max"))		return HealthAggregationMax;

	xsUnknownError("invalid aggregation");
	return HealthAggregationSum;	// unreachable
}

static HealthServiceTimeScope parseScope(xsMachine *the, xsSlot *slot)
{
	char *buf = xsmcToString(*slot);
	if (!c_strcmp(buf, "once"))					return HealthServiceTimeScopeOnce;
	if (!c_strcmp(buf, "weekly"))				return HealthServiceTimeScopeWeekly;
	if (!c_strcmp(buf, "weekday or weekend"))	return HealthServiceTimeScopeDailyWeekdayOrWeekend;
	if (!c_strcmp(buf, "daily"))				return HealthServiceTimeScopeDaily;

	xsUnknownError("invalid scope");
	return HealthServiceTimeScopeOnce;	// unreachable
}

static HealthIterationDirection parseDirection(xsMachine *the, xsSlot *slot)
{
	char *buf = xsmcToString(*slot);
	if (!c_strcmp(buf, "past"))		return HealthIterationDirectionPast;
	if (!c_strcmp(buf, "future"))	return HealthIterationDirectionFuture;

	xsUnknownError("invalid direction");
	return HealthIterationDirectionPast;	// unreachable
}

#define accessibilityToJS(c_mask) ((c_mask) ^ (HealthServiceAccessibilityMaskNoPermission | HealthServiceAccessibilityMaskNotSupported | HealthServiceAccessibilityMaskNotAvailable))

void xs_health_metric_get(xsMachine *the)
{
	HealthMetric metric = parseMetric(the, &xsArg(0));
	HealthValue value = health_service_peek_current_value(metric);
	xsmcSetInteger(xsResult, value);
}

void xs_health_metric_query(xsMachine *the)
{
	xsSlot tmp;
	xsmcGet(tmp, xsArg(0), xsID_metric);
	HealthMetric metric = parseMetric(the, &tmp);

	int hasStart = xsmcHas(xsArg(0), xsID_start);
	int hasEnd = xsmcHas(xsArg(0), xsID_end);

	if (!hasStart && !hasEnd) {
		HealthValue value = health_service_sum_today(metric);
		xsmcSetInteger(xsResult, value);
		return;
	}
	if (!hasStart || !hasEnd)
		xsUnknownError("start and end required");

	xsmcGet(tmp, xsArg(0), xsID_start);
	time_t start = SECONDS_FROM_MS(xsmcToNumber(tmp));

	xsmcGet(tmp, xsArg(0), xsID_end);
	time_t end = SECONDS_FROM_MS(xsmcToNumber(tmp));

	HealthAggregation aggregation = HealthAggregationSum;
	if (xsmcGet(tmp, xsArg(0), xsID_aggregation))
		aggregation = parseAggregation(the, &tmp);

	HealthServiceTimeScope scope = HealthServiceTimeScopeOnce;
	if (xsmcGet(tmp, xsArg(0), xsID_scope))
		scope = parseScope(the, &tmp);

	HealthValue value = health_service_aggregate_averaged(metric, start, end, aggregation, scope);
	xsmcSetInteger(xsResult, value);
}

void xs_health_metric_accessible(xsMachine *the)
{
	xsSlot tmp;
	xsmcGet(tmp, xsArg(0), xsID_metric);
	HealthMetric metric = parseMetric(the, &tmp);

	xsmcGet(tmp, xsArg(0), xsID_start);
	time_t start = SECONDS_FROM_MS(xsmcToNumber(tmp));

	xsmcGet(tmp, xsArg(0), xsID_end);
	time_t end = SECONDS_FROM_MS(xsmcToNumber(tmp));

	HealthAggregation aggregation = HealthAggregationSum;
	if (xsmcGet(tmp, xsArg(0), xsID_aggregation))
		aggregation = parseAggregation(the, &tmp);

	HealthServiceTimeScope scope = HealthServiceTimeScopeOnce;
	if (xsmcGet(tmp, xsArg(0), xsID_scope))
		scope = parseScope(the, &tmp);

	HealthServiceAccessibilityMask mask =
		health_service_metric_aggregate_averaged_accessible(metric, start, end, aggregation, scope);
	xsmcSetInteger(xsResult, accessibilityToJS(mask));
}

void xs_health_activity_get(xsMachine *the)
{
	HealthActivityMask mask = health_service_peek_current_activities();
	xsmcSetInteger(xsResult, mask);
}

static bool activityIterateCallback(HealthActivity activity, time_t time_start, time_t time_end, void *context)
{
	xsMachine *the = context;
	xsmcSetInteger(xsVar(1), activity);
	xsmcSetNumber(xsVar(2), MS_FROM_SECONDS(time_start));
	xsmcSetNumber(xsVar(3), MS_FROM_SECONDS(time_end));
	xsCallFunction3(xsVar(0), xsUndefined, xsVar(1), xsVar(2), xsVar(3));
	return xsmcToBoolean(xsResult);
}

void xs_health_activity_iterate(xsMachine *the)
{
	xsmcVars(4);

	xsSlot tmp;
	xsmcGet(tmp, xsArg(0), xsID_activities);
	HealthActivityMask mask = xsmcToInteger(tmp);

	xsmcGet(tmp, xsArg(0), xsID_start);
	time_t start = SECONDS_FROM_MS(xsmcToNumber(tmp));

	xsmcGet(tmp, xsArg(0), xsID_end);
	time_t end = SECONDS_FROM_MS(xsmcToNumber(tmp));

	HealthIterationDirection direction = HealthIterationDirectionPast;
	if (xsmcGet(tmp, xsArg(0), xsID_direction))
		direction = parseDirection(the, &tmp);

	xsmcGet(xsVar(0), xsArg(0), xsID_callback);

	health_service_activities_iterate(mask, start, end, direction, activityIterateCallback, the);
}

void xs_health_activity_accessible(xsMachine *the)
{
	xsSlot tmp;
	xsmcGet(tmp, xsArg(0), xsID_activities);
	HealthActivityMask mask = xsmcToInteger(tmp);

	xsmcGet(tmp, xsArg(0), xsID_start);
	time_t start = SECONDS_FROM_MS(xsmcToNumber(tmp));

	xsmcGet(tmp, xsArg(0), xsID_end);
	time_t end = SECONDS_FROM_MS(xsmcToNumber(tmp));

	HealthServiceAccessibilityMask access_mask = health_service_any_activity_accessible(mask, start, end);
	xsmcSetInteger(xsResult, accessibilityToJS(access_mask));
}

void xs_health_heartrate_set_sample_period(xsMachine *the)
{
	time_t seconds = SECONDS_FROM_MS(xsmcToNumber(xsArg(0)));
	if (seconds > UINT16_MAX)
		seconds = UINT16_MAX;
	if (!health_service_set_heart_rate_sample_period((uint16_t)seconds))
		xsUnknownError("set_heart_rate_sample_period failed");
}

void xs_health_heartrate_get_expiration(xsMachine *the)
{
	uint16_t seconds = health_service_get_heart_rate_sample_period_expiration_sec();
	xsmcSetUnsigned(xsResult, (xsUnsignedValue)seconds * 1000);
}

void xs_health_history_minute(xsMachine *the)
{
	xsmcVars(2);

	xsSlot tmp;
	xsmcGet(tmp, xsArg(0), xsID_length);
	xsIntegerValue length = xsmcToInteger(tmp);
	if (length <= 0)
		xsUnknownError("invalid length");

	xsmcGet(tmp, xsArg(0), xsID_start);
	time_t start = SECONDS_FROM_MS(xsmcToNumber(tmp));

	xsmcGet(tmp, xsArg(0), xsID_end);
	time_t end = SECONDS_FROM_MS(xsmcToNumber(tmp));

	HealthMinuteData *data = c_calloc(length, sizeof(HealthMinuteData));
	if (!data)
		xsRangeError("no memory");

	uint32_t actual = health_service_get_minute_history(data, length, &start, &end);

	xsmcSetNewArray(xsResult, actual);
	for (uint32_t i = 0; i < actual; i++) {
		if (data[i].is_invalid)
			continue;		// leave the slot undefined

		xsmcSetNewObject(xsVar(0));

		xsmcSetInteger(xsVar(1), data[i].steps);
		xsmcSet(xsVar(0), xsID_steps, xsVar(1));

		xsmcSetInteger(xsVar(1), data[i].orientation);
		xsmcSet(xsVar(0), xsID_orientation, xsVar(1));

		xsmcSetInteger(xsVar(1), data[i].vmc);
		xsmcSet(xsVar(0), xsID_vmc, xsVar(1));

		xsmcSetInteger(xsVar(1), data[i].light);
		xsmcSet(xsVar(0), xsID_light, xsVar(1));

		xsmcSetInteger(xsVar(1), data[i].heart_rate_bpm);
		xsmcSet(xsVar(0), xsID_heartRate, xsVar(1));

		xsmcSetIndex(xsResult, i, xsVar(0));
	}

	c_free(data);

	xsmcSetNumber(xsVar(1), MS_FROM_SECONDS(start));
	xsmcSet(xsResult, xsID_start, xsVar(1));
	xsmcSetNumber(xsVar(1), MS_FROM_SECONDS(end));
	xsmcSet(xsResult, xsID_end, xsVar(1));
}

void xs_health_measurement_system(xsMachine *the)
{
	HealthMetric metric = parseMetric(the, &xsArg(0));
	MeasurementSystem system = health_service_get_measurement_system_for_display(metric);

	switch (system) {
		case MeasurementSystemMetric:	xsmcSetStringX(xsResult, "metric"); break;
		case MeasurementSystemImperial:	xsmcSetStringX(xsResult, "imperial"); break;
		default:						/* xsResult remains undefined */ break;
	}
}

void xs_health_alert_destructor(void *data)
{
	if (data)
		health_service_cancel_metric_alert((HealthMetricAlert *)data);
}

void xs_health_alert(xsMachine *the)
{
	xsSlot tmp;
	xsmcGet(tmp, xsArg(0), xsID_metric);
	HealthMetric metric = parseMetric(the, &tmp);

	if (!xsmcGet(tmp, xsArg(0), xsID_threshold))
		xsUnknownError("threshold required");
	HealthValue threshold = xsmcToInteger(tmp);

	HealthMetricAlert *alert = health_service_register_metric_alert(metric, threshold);
	if (!alert)
		xsUnknownError("register_metric_alert failed");

	xsmcSetHostData(xsThis, alert);
}

void xs_health_alert_close(xsMachine *the)
{
	if (!xsmcGetHostData(xsThis)) return;

	HealthMetricAlert *alert = xsmcGetHostDataValidate(xsThis, xs_health_alert_destructor);
	health_service_cancel_metric_alert(alert);
	xsmcSetHostData(xsThis, NULL);
}
