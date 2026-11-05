'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSettings, validateSettings, calculate } = require('../../public/assets/salary-core.js');

const settings = normalizeSettings();
const local = (year, month, day, hour = 0, minute = 0, second = 0, milliseconds = 0) => new Date(year, month - 1, day, hour, minute, second, milliseconds);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('scheduled time excludes lunch, earnings pause during lunch and resume at its end', () => {
    const start = calculate(local(2026, 11, 5, 9), settings);
    assert.equal(start.status, 'working');
    assert.equal(start.workSeconds, 7.5 * 3600);
    assert.equal(start.earned, 0);
    assert.equal(start.remainingSeconds, 9 * 3600);

    const lunchStart = calculate(local(2026, 11, 5, 12), settings);
    const lunchMiddle = calculate(local(2026, 11, 5, 12, 45), settings);
    const lunchEnd = calculate(local(2026, 11, 5, 13, 30), settings);
    assert.equal(lunchStart.status, 'break');
    assert.equal(lunchMiddle.status, 'break');
    assert.equal(lunchEnd.status, 'working');
    for (const result of [lunchStart, lunchMiddle, lunchEnd]) {
        assert.equal(result.elapsedSeconds, 3 * 3600);
        assert.equal(result.earned, 80);
        assert.equal(result.progress, 40);
    }
    const afterLunch = calculate(local(2026, 11, 5, 13, 30, 1), settings);
    assert.equal(afterLunch.elapsedSeconds, 3 * 3600 + 1);
    close(afterLunch.earned - lunchEnd.earned, afterLunch.perSecond);
});

test('before-work, subsecond, final second and end boundaries never overpay', () => {
    const before = calculate(local(2026, 11, 5, 8, 59, 59), settings);
    assert.equal(before.status, 'before');
    assert.equal(before.remainingSeconds, 1);
    assert.equal(before.earned, 0);

    const fractional = calculate(local(2026, 11, 5, 9, 0, 0, 500), settings);
    assert.equal(fractional.elapsedSeconds, 0.5);
    assert.equal(fractional.remainingSeconds, 9 * 3600);
    close(fractional.earned, fractional.perSecond / 2);

    const last = calculate(local(2026, 11, 5, 17, 59, 59), settings);
    assert.equal(last.status, 'working');
    assert.equal(last.remainingSeconds, 1);
    close(settings.dailyPay - last.earned, last.perSecond);
    for (const hour of [18, 23]) {
        const result = calculate(local(2026, 11, 5, hour), settings);
        assert.equal(result.status, 'after');
        assert.equal(result.elapsedSeconds, result.workSeconds);
        assert.equal(result.progress, 100);
        assert.equal(result.remainingSeconds, 0);
        assert.equal(result.earned, settings.dailyPay);
    }
});

test('off days do not accrue earnings; selected weekend schedules do', () => {
    const saturday = calculate(local(2026, 11, 7, 16), settings);
    assert.equal(saturday.status, 'off');
    assert.equal(saturday.isWorkday, false);
    assert.equal(saturday.elapsedSeconds, 0);
    assert.equal(saturday.progress, 0);
    assert.equal(saturday.earned, 0);
    assert.equal(saturday.remainingSeconds, 0);

    const weekend = { ...settings, workdays: [0, 6] };
    const workedSaturday = calculate(local(2026, 11, 7, 18), weekend);
    assert.equal(workedSaturday.status, 'after');
    assert.equal(workedSaturday.earned, 200);
    const sunday = calculate(local(2026, 11, 8, 9), weekend);
    assert.equal(sunday.status, 'working');
    assert.equal(calculate(local(2026, 11, 9, 18), weekend).status, 'off');
});

test('monthly estimates include prior scheduled days and current earnings, never future days', () => {
    const first = calculate(local(2026, 11, 1, 20), settings);
    assert.equal(first.status, 'off');
    assert.equal(first.completedWorkdays, 0);
    assert.equal(first.monthEstimate, 0);
    assert.equal(first.monthWorkdays, 21);

    const thursdayNoon = calculate(local(2026, 11, 5, 12), settings);
    assert.equal(thursdayNoon.completedWorkdays, 3);
    assert.equal(thursdayNoon.monthEstimate, 3 * 200 + 80);
    assert.equal(calculate(local(2026, 11, 7, 12), settings).monthEstimate, 5 * 200);
    assert.equal(calculate(local(2026, 11, 30, 18), settings).monthEstimate, 21 * 200);
    assert.equal(calculate(local(2026, 12, 1, 8), settings).monthEstimate, 0);
});

test('leap-day and year boundaries use the current local calendar month', () => {
    const leap = calculate(local(2024, 2, 29, 18), settings);
    assert.equal(leap.monthWorkdays, 21);
    assert.equal(leap.completedWorkdays, 20);
    assert.equal(leap.monthEstimate, 4200);
    const afterNewYear = calculate(local(2027, 1, 1, 9), settings);
    assert.equal(afterNewYear.completedWorkdays, 0);
    assert.equal(afterNewYear.monthEstimate, 0);
    assert.equal(afterNewYear.monthWorkdays, 21);
});

test('zero pay and no-lunch schedules remain finite', () => {
    const unpaid = calculate(local(2026, 11, 5, 18), { ...settings, dailyPay: 0 });
    assert.equal(unpaid.earned, 0);
    assert.equal(unpaid.monthEstimate, 0);
    assert.equal(unpaid.hourlyRate, 0);
    assert.equal(unpaid.perSecond, 0);
    assert.equal(unpaid.progress, 100);

    const continuous = calculate(local(2026, 11, 5, 12), { ...settings, breakEnabled: false });
    assert.equal(continuous.status, 'working');
    assert.equal(continuous.workSeconds, 9 * 3600);
    close(continuous.earned, 200 / 3);
    assert.ok(Object.values(continuous).filter((value) => typeof value === 'number').every(Number.isFinite));
});

test('invalid dates fail clearly instead of displaying NaN', () => {
    for (const value of [new Date(NaN), '2026-11-05', null, undefined]) {
        assert.throws(() => calculate(value, settings), TypeError);
    }
});

test('normalization recovers corrupt storage, migrates legacy shifts and creates independent arrays', () => {
    for (const value of [null, undefined, [], 'broken', 42]) assert.deepEqual(normalizeSettings(value), settings);
    const malformed = normalizeSettings({
        dailyPay: Infinity,
        start: '<script>',
        end: '24:60',
        breakEnabled: 'false',
        breakStart: {},
        workdays: [null, '1', 100, -1, 2, 2, 6]
    });
    assert.deepEqual(malformed, { ...settings, workdays: [2, 6] });
    assert.deepEqual(normalizeSettings({ workdays: [] }).workdays, settings.workdays);
    const custom = normalizeSettings({}, { start: '10:00', end: '11:00' });
    assert.equal(custom.start, '10:00');
    assert.equal(custom.end, '11:00');
    assert.equal(custom.breakEnabled, false);
    assert.equal(calculate(local(2026, 11, 5, 10, 30), custom).earned, 100);
    assert.equal(normalizeSettings({ start: '22:00', end: '06:00' }).start, '09:00');
    assert.equal(normalizeSettings({ dailyPay: -50 }).dailyPay, 0);
    assert.equal(normalizeSettings({ dailyPay: 1e12 }).dailyPay, 1000000);
    assert.equal(normalizeSettings({ dailyPay: '123.456' }).dailyPay, 123.46);
    assert.equal(normalizeSettings({ dailyPay: '' }).dailyPay, 200);
    assert.equal(normalizeSettings({ dailyPay: '0x100' }).dailyPay, 200);
    const independent = normalizeSettings();
    independent.workdays.push(6);
    assert.deepEqual(normalizeSettings().workdays, [1, 2, 3, 4, 5]);
});

test('form validation rejects invalid and cross-midnight shifts without silently normalizing them', () => {
    assert.deepEqual(validateSettings(settings), { valid: true });
    assert.equal(validateSettings({ ...settings, dailyPay: '123.45' }).valid, true);
    for (const dailyPay of [-1, 1000001, NaN, Infinity, '', null]) {
        assert.equal(validateSettings({ ...settings, dailyPay }).field, 'dailyPay');
    }
    assert.equal(validateSettings({ ...settings, start: '18:00', end: '09:00' }).field, 'end');
    assert.equal(validateSettings({ ...settings, start: '09:00', end: '09:00' }).field, 'end');
    assert.equal(validateSettings({ ...settings, start: '24:00' }).field, 'start');
    assert.equal(validateSettings({ ...settings, breakStart: '08:00' }).field, 'breakEnd');
    assert.equal(validateSettings({ ...settings, breakEnd: '19:00' }).field, 'breakEnd');
    assert.equal(validateSettings({ ...settings, breakStart: '13:00', breakEnd: '12:00' }).field, 'breakEnd');
    assert.equal(validateSettings({ ...settings, breakStart: settings.start, breakEnd: settings.end }).field, 'breakEnd');
    assert.equal(validateSettings({ ...settings, workdays: [] }).field, 'workdays');
    assert.equal(validateSettings({ ...settings, workdays: ['1'] }).field, 'workdays');
    assert.equal(validateSettings({ ...settings, breakEnabled: false, breakStart: '', breakEnd: '' }).valid, true);
    assert.equal(validateSettings({ ...settings, breakEnabled: true, breakStart: settings.start, breakEnd: '10:00' }).valid, true);
});

test('second-precision shifts accrue exactly between their start and end', () => {
    const precise = { ...settings, dailyPay: 50, start: '09:00:15', end: '09:01:05', breakEnabled: false };
    assert.deepEqual(validateSettings(precise), { valid: true });
    assert.equal(normalizeSettings(precise).start, '09:00:15');
    assert.equal(normalizeSettings(precise).end, '09:01:05');

    const before = calculate(local(2026, 11, 5, 9, 0, 14), precise);
    assert.equal(before.status, 'before');
    assert.equal(before.remainingSeconds, 1);
    assert.equal(before.earned, 0);

    const start = calculate(local(2026, 11, 5, 9, 0, 15), precise);
    assert.equal(start.status, 'working');
    assert.equal(start.workSeconds, 50);
    assert.equal(start.elapsedSeconds, 0);
    assert.equal(start.remainingSeconds, 50);
    assert.equal(start.perSecond, 1);

    const middle = calculate(local(2026, 11, 5, 9, 0, 40), precise);
    assert.equal(middle.elapsedSeconds, 25);
    assert.equal(middle.remainingSeconds, 25);
    assert.equal(middle.earned, 25);
    assert.equal(middle.progress, 50);

    const last = calculate(local(2026, 11, 5, 9, 1, 4), precise);
    assert.equal(last.status, 'working');
    assert.equal(last.remainingSeconds, 1);
    assert.equal(last.earned, 49);
    const end = calculate(local(2026, 11, 5, 9, 1, 5), precise);
    assert.equal(end.status, 'after');
    assert.equal(end.remainingSeconds, 0);
    assert.equal(end.earned, 50);
    assert.equal(end.progress, 100);

    const sameMinute = { ...precise, end: '09:00:16' };
    assert.equal(validateSettings(sameMinute).valid, true);
    assert.equal(calculate(local(2026, 11, 5, 9, 0, 16), sameMinute).workSeconds, 1);
});

test('second-precision lunch boundaries pause only the selected seconds', () => {
    const precise = {
        ...settings,
        dailyPay: 40,
        start: '09:00:15',
        end: '09:01:05',
        breakStart: '09:00:30',
        breakEnd: '09:00:40'
    };
    assert.equal(validateSettings(precise).valid, true);
    const beforeLunch = calculate(local(2026, 11, 5, 9, 0, 29), precise);
    assert.equal(beforeLunch.status, 'working');
    assert.equal(beforeLunch.workSeconds, 40);
    assert.equal(beforeLunch.earned, 14);
    for (const second of [30, 35, 39]) {
        const lunch = calculate(local(2026, 11, 5, 9, 0, second), precise);
        assert.equal(lunch.status, 'break');
        assert.equal(lunch.elapsedSeconds, 15);
        assert.equal(lunch.earned, 15);
    }
    const resumed = calculate(local(2026, 11, 5, 9, 0, 40), precise);
    assert.equal(resumed.status, 'working');
    assert.equal(resumed.earned, 15);
    assert.equal(calculate(local(2026, 11, 5, 9, 0, 41), precise).earned, 16);
    assert.equal(calculate(local(2026, 11, 5, 9, 1, 5), precise).earned, 40);
});

test('the final second of the day is a valid shift endpoint', () => {
    const precise = { ...settings, dailyPay: 59, start: '23:59:00', end: '23:59:59', breakEnabled: false };
    assert.equal(validateSettings(precise).valid, true);
    const last = calculate(local(2026, 11, 5, 23, 59, 58), precise);
    assert.equal(last.workSeconds, 59);
    assert.equal(last.remainingSeconds, 1);
    assert.equal(last.earned, 58);
    const end = calculate(local(2026, 11, 5, 23, 59, 59), precise);
    assert.equal(end.status, 'after');
    assert.equal(end.earned, 59);
    assert.equal(end.remainingSeconds, 0);
});

test('minute-only settings remain unchanged and calculate like zero seconds', () => {
    assert.deepEqual(normalizeSettings(settings), settings);
    const full = Object.fromEntries(Object.entries(settings).map(([key, value]) => [
        key,
        ['start', 'end', 'breakStart', 'breakEnd'].includes(key) ? `${value}:00` : value
    ]));
    for (const time of [[8, 59, 59], [9, 0, 0], [12, 0, 1], [13, 30, 0], [17, 59, 59], [18, 0, 0]]) {
        const now = local(2026, 11, 5, ...time);
        assert.deepEqual(calculate(now, full), calculate(now, settings));
    }
    const legacy = normalizeSettings({}, { start: '08:30', end: '17:30' });
    assert.equal(legacy.start, '08:30');
    assert.equal(legacy.end, '17:30');
});

test('seconds validation rejects invalid fields without discarding valid precision', () => {
    const precise = { ...settings, start: '09:00:01', end: '18:00:02', breakStart: '12:00:03', breakEnd: '13:30:04' };
    assert.equal(validateSettings(precise).valid, true);
    assert.deepEqual(normalizeSettings(precise), precise);
    for (const start of ['09:00:60', '09:00:1', '9:00:01', '09:00:00:00', '24:00:00', '09:60:00', '09:00:00.5']) {
        assert.equal(validateSettings({ ...precise, start }).field, 'start');
    }
    for (const end of ['18:00:60', '18:00:00:00', precise.start, '09:00:00']) {
        assert.equal(validateSettings({ ...precise, end }).field, 'end');
    }
    assert.equal(validateSettings({ ...precise, breakStart: '12:00:60' }).field, 'breakEnd');
    assert.equal(validateSettings({ ...precise, breakEnd: '13:30:60' }).field, 'breakEnd');
    assert.equal(validateSettings({ ...precise, breakEnd: precise.breakStart }).field, 'breakEnd');
});
