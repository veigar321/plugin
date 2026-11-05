/* Local estimates only: no attendance, overtime, holidays or tax data is inferred. */
(function (root, factory) {
    'use strict';

    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.WorkdaySalary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const defaults = {
        dailyPay: 200,
        start: '09:00',
        end: '18:00',
        breakEnabled: true,
        breakStart: '12:00',
        breakEnd: '13:30',
        workdays: [1, 2, 3, 4, 5]
    };
    const maxDailyPay = 1000000;
    const validTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
    const secondsOf = (value) => {
        const [hours, minutes, seconds = 0] = value.split(':').map(Number);
        return hours * 3600 + minutes * 60 + seconds;
    };
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const validDay = (value) => Number.isInteger(value) && value >= 0 && value <= 6;

    function amount(value) {
        if (typeof value === 'number') return value;
        if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value.trim());
        return NaN;
    }

    function validShift(start, end) {
        return validTime(start) && validTime(end) && secondsOf(start) < secondsOf(end);
    }

    function validBreak(settings) {
        if (!validTime(settings.breakStart) || !validTime(settings.breakEnd)) return false;
        const start = secondsOf(settings.start);
        const end = secondsOf(settings.end);
        const breakStart = secondsOf(settings.breakStart);
        const breakEnd = secondsOf(settings.breakEnd);
        return breakStart >= start && breakEnd <= end && breakStart < breakEnd
            && breakEnd - breakStart < end - start;
    }

    /**
     * Recover saved browser settings without allowing malformed values into the clock.
     * legacy may contain the earlier encouragement page's start/end settings.
     */
    function normalizeSettings(input, legacy) {
        const saved = record(input);
        const previous = record(legacy);
        const baseStart = validShift(previous.start, previous.end) ? previous.start : defaults.start;
        const baseEnd = validShift(previous.start, previous.end) ? previous.end : defaults.end;
        let start = validTime(saved.start) ? saved.start : baseStart;
        let end = validTime(saved.end) ? saved.end : baseEnd;
        if (!validShift(start, end)) {
            start = baseStart;
            end = baseEnd;
        }

        const pay = amount(saved.dailyPay);
        const days = Array.isArray(saved.workdays) ? [...new Set(saved.workdays.filter(validDay))].sort((a, b) => a - b) : [];
        const settings = {
            dailyPay: Number.isFinite(pay) ? Math.round(clamp(pay, 0, maxDailyPay) * 100) / 100 : defaults.dailyPay,
            start,
            end,
            breakEnabled: typeof saved.breakEnabled === 'boolean' ? saved.breakEnabled : defaults.breakEnabled,
            breakStart: validTime(saved.breakStart) ? saved.breakStart : defaults.breakStart,
            breakEnd: validTime(saved.breakEnd) ? saved.breakEnd : defaults.breakEnd,
            workdays: days.length ? days : [...defaults.workdays]
        };
        if (settings.breakEnabled && !validBreak(settings)) settings.breakEnabled = false;
        return settings;
    }

    /** Validate submitted settings strictly; normalization is for recovery, not form validation. */
    function validateSettings(input) {
        const settings = record(input);
        const fail = (field, error) => ({ valid: false, field, error });
        const pay = amount(settings.dailyPay);
        if (!Number.isFinite(pay) || pay < 0 || pay > maxDailyPay) {
            return fail('dailyPay', '请输入 0 到 1,000,000 元之间的日薪。');
        }
        if (!validTime(settings.start)) return fail('start', '请选择有效的上班时间。');
        if (!validTime(settings.end) || !validShift(settings.start, settings.end)) {
            return fail('end', '下班时间需晚于上班时间，暂不支持跨夜班次。');
        }
        if (typeof settings.breakEnabled !== 'boolean') return fail('breakEnabled', '请选择是否扣除午休时间。');
        if (settings.breakEnabled && !validBreak(settings)) {
            return fail('breakEnd', '午休需在上下班时间内，且扣除午休后需保留工作时间。');
        }
        if (!Array.isArray(settings.workdays) || !settings.workdays.length || !settings.workdays.every(validDay)) {
            return fail('workdays', '请至少选择一个有效的工作日。');
        }
        return { valid: true };
    }

    /**
     * Derive estimates from a local Date, never from previously incremented counters.
     * elapsedSeconds retains fractional seconds; remainingSeconds rounds up for display.
     * A scheduled day's pay is proportional to scheduled time excluding the unpaid break.
     * monthEstimate treats earlier scheduled days as fully attended; future days are excluded.
     */
    function calculate(now, input) {
        if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
            throw new TypeError('calculate requires a valid Date.');
        }
        const settings = normalizeSettings(input);
        const start = secondsOf(settings.start);
        const end = secondsOf(settings.end);
        const breakStart = secondsOf(settings.breakStart);
        const breakEnd = secondsOf(settings.breakEnd);
        const breakSeconds = settings.breakEnabled ? breakEnd - breakStart : 0;
        const workSeconds = end - start - breakSeconds;
        const current = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
        const isWorkday = settings.workdays.includes(now.getDay());

        let status = 'off';
        let elapsedSeconds = 0;
        let remainingSeconds = 0;
        if (isWorkday) {
            const elapsedShift = clamp(current - start, 0, end - start);
            const elapsedBreak = settings.breakEnabled ? clamp(current - breakStart, 0, breakSeconds) : 0;
            elapsedSeconds = clamp(elapsedShift - elapsedBreak, 0, workSeconds);
            if (current < start) {
                status = 'before';
                remainingSeconds = Math.ceil(start - current);
            } else if (current >= end) {
                status = 'after';
            } else {
                status = settings.breakEnabled && current >= breakStart && current < breakEnd ? 'break' : 'working';
                remainingSeconds = Math.ceil(end - current);
            }
        }

        const progress = elapsedSeconds / workSeconds * 100;
        const earned = settings.dailyPay * (elapsedSeconds / workSeconds);
        let completedWorkdays = 0;
        let monthWorkdays = 0;
        const year = now.getFullYear();
        const month = now.getMonth();
        const lastDay = new Date(year, month + 1, 0, 12).getDate();
        for (let day = 1; day <= lastDay; day += 1) {
            if (!settings.workdays.includes(new Date(year, month, day, 12).getDay())) continue;
            monthWorkdays += 1;
            if (day < now.getDate()) completedWorkdays += 1;
        }

        return {
            status,
            isWorkday,
            workSeconds,
            elapsedSeconds,
            remainingSeconds,
            progress,
            earned,
            hourlyRate: settings.dailyPay * 3600 / workSeconds,
            perSecond: settings.dailyPay / workSeconds,
            monthEstimate: completedWorkdays * settings.dailyPay + earned,
            completedWorkdays,
            monthWorkdays
        };
    }

    return Object.freeze({ normalizeSettings, validateSettings, calculate });
});
