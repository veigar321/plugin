(() => {
    'use strict';

    const salary = globalThis.WorkdaySalary;
    if (!salary) return;

    const payStorageKey = 'workday-pay:v1';
    const petStorageKey = 'workday-pet:v1';
    const byId = (id) => document.getElementById(id);
    const on = (id, event, handler) => byId(id)?.addEventListener(event, handler);
    const pad = (number) => String(number).padStart(2, '0');
    const formatHours = (seconds) => Number((seconds / 3600).toFixed(2)).toString();
    const money = (amount) => `¥${amount.toFixed(2)}`;
    const timeSeconds = (time) => {
        const [hours, minutes, seconds = 0] = time.split(':').map(Number);
        return hours * 3600 + minutes * 60 + seconds;
    };
    const formatTime = (value) => {
        if (typeof value !== 'string') return value;
        const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
        return match ? `${match[1]}:${match[2]}:${match[3] || '00'}` : value;
    };
    const setText = (id, value) => {
        const element = byId(id);
        if (element && element.textContent !== String(value)) element.textContent = value;
    };
    const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

    function readStorage(key) {
        try {
            const saved = JSON.parse(localStorage.getItem(key) || 'null');
            return isRecord(saved) ? saved : null;
        } catch (_) {
            return null;
        }
    }

    function saveStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (_) {
            return false;
        }
    }

    const desktopMode = Boolean(globalThis.webkit?.messageHandlers?.petNative);
    const petMode = desktopMode || /^\/pet\/?$/.test(window.location.pathname);
    let settings = salary.normalizeSettings(readStorage(payStorageKey), readStorage('workday-club:v1'));
    const savedPet = readStorage(petStorageKey) || {};
    const pet = {
        x: typeof savedPet.x === 'number' && Number.isFinite(savedPet.x) ? savedPet.x : null,
        y: typeof savedPet.y === 'number' && Number.isFinite(savedPet.y) ? savedPet.y : null,
        collapsed: typeof savedPet.collapsed === 'boolean' ? savedPet.collapsed : desktopMode || !petMode,
        view: savedPet.view === 'quote' ? 'quote' : 'salary'
    };
    const widget = byId('pet-widget');
    const handle = byId('pet-drag-handle');
    const panel = byId('pet-panel');
    const payDialog = byId('pay-dialog');
    let toastTimeout;
    let happyTimeout;
    let drag = null;

    if (petMode) document.body.classList.add('is-pet-mode');
    if (desktopMode) document.body.classList.add('is-desktop-pet');
    // Save normalized settings once, including migration from the earlier shift fields.
    saveStorage(payStorageKey, settings);

    function toast(message) {
        const element = byId('pet-toast');
        if (!element) return;
        clearTimeout(toastTimeout);
        element.textContent = message;
        element.classList.add('is-visible');
        toastTimeout = setTimeout(() => element.classList.remove('is-visible'), 3200);
    }

    function duration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor(seconds % 3600 / 60);
        const rest = seconds % 60;
        return `${hours ? `${hours}小时` : ''}${minutes}分${pad(rest)}秒`;
    }

    function renderClock() {
        const now = new Date();
        const result = salary.calculate(now, settings);
        const statusText = {
            before: '还没上班',
            working: '上班中',
            break: '午休中',
            after: '已下班',
            off: '今天休息'
        }[result.status];
        let countdown;
        let countdownLabel;
        let countdownNote;
        if (result.status === 'before') {
            countdown = `距离上班还有 ${duration(result.remainingSeconds)}`;
            countdownLabel = '距离上班，还有';
            countdownNote = '还没到上班时间，先享受自己的早晨。';
        } else if (result.status === 'working' || result.status === 'break') {
            countdown = `距离下班还有 ${duration(result.remainingSeconds)}（${formatTime(settings.end)} 下班）`;
            countdownLabel = result.status === 'break' ? '午休中，距离下班还有' : '距离快乐下班，还有';
            countdownNote = result.status === 'break'
                ? '午休暂停累计，放松一下再出发。'
                : result.progress >= 80 ? '最后一小段啦，快到属于你的时间了。' : '每一秒努力，都在走向下班。';
        } else if (result.status === 'after') {
            countdown = `今天辛苦了，${formatTime(settings.end)} 已下班`;
            countdownLabel = '今天的班，就上到这里';
            countdownNote = '今天的收入已满格，去好好生活吧。';
        } else {
            countdown = '今天没有排班，安心享受休息';
            countdownLabel = '休息日，时间属于你';
            countdownNote = '今天不累计收入，也值得被好好照顾。';
        }

        const breakSeconds = settings.breakEnabled ? timeSeconds(settings.breakEnd) - timeSeconds(settings.breakStart) : 0;
        const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}  ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]}`;
        const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        const fields = {
            date,
            clock,
            status: statusText,
            schedule: `每日 ${formatHours(result.workSeconds)} 小时 · ${settings.breakEnabled ? `午休 ${formatHours(breakSeconds)} 小时` : '不扣午休'}`,
            countdown,
            earned: result.earned.toFixed(4),
            rate: (result.status === 'working' ? result.perSecond : 0).toFixed(4),
            progressText: `${result.progress.toFixed(1)}%`,
            hours: `已工作 ${(result.elapsedSeconds / 3600).toFixed(2)} / ${(result.workSeconds / 3600).toFixed(2)} 小时`,
            hourly: money(result.hourlyRate),
            daily: money(settings.dailyPay),
            month: money(result.monthEstimate),
            equivalents: result.earned >= 2
                ? `¥${result.earned.toFixed(2)} 能换：矿泉水 ${Math.floor(result.earned / 2)} 瓶（¥2）｜柠檬水 ${Math.floor(result.earned / 4)} 杯（¥4）｜煎饼果子 ${Math.floor(result.earned / 8)} 份（¥8），按参考单价估算。`
                : '小小的积累，也在慢慢变多。'
        };
        document.querySelectorAll('[data-pay]').forEach((element) => {
            const field = element.dataset.pay;
            if (field === 'progress') {
                element.value = result.progress;
                element.setAttribute('aria-valuetext', `今日工时已完成 ${result.progress.toFixed(1)}%`);
            } else if (Object.prototype.hasOwnProperty.call(fields, field) && element.textContent !== fields[field]) {
                element.textContent = fields[field];
            }
        });

        window.dispatchEvent(new CustomEvent('workday:pay', { detail: fields }));

        setText('pay-progress-note', `本月已过 ${result.completedWorkdays} 个排班日按满勤估算；不含请假、加班及税费。`);
        setText('countdown-label', countdownLabel);
        setText('countdown-note', countdownNote);
        setText('countdown-hours', pad(Math.floor(result.remainingSeconds / 3600)));
        setText('countdown-minutes', pad(Math.floor(result.remainingSeconds % 3600 / 60)));
        setText('countdown-seconds', pad(result.remainingSeconds % 60));
        setText('shift-range', `${formatTime(settings.start)} — ${formatTime(settings.end)}`);
        const progress = byId('work-progress');
        if (progress) {
            progress.value = result.progress;
            progress.setAttribute('aria-valuetext', `今日有效工时已过 ${result.progress.toFixed(1)}%`);
        }
        const countdownTimer = document.querySelector('.countdown[role="timer"]');
        countdownTimer?.setAttribute('aria-label', countdown);
        if (widget) widget.dataset.state = result.status;
    }

    function breakFields() {
        const enabled = byId('pay-break-enabled')?.checked === true;
        ['pay-break-start', 'pay-break-end'].forEach((id) => {
            const input = byId(id);
            if (input) input.disabled = !enabled;
        });
    }

    function fillSettings() {
        const fields = {
            'pay-daily': settings.dailyPay,
            'pay-start': formatTime(settings.start),
            'pay-end': formatTime(settings.end),
            'pay-break-start': formatTime(settings.breakStart),
            'pay-break-end': formatTime(settings.breakEnd)
        };
        Object.entries(fields).forEach(([id, value]) => {
            const input = byId(id);
            if (input) input.value = value;
        });
        if (byId('pay-break-enabled')) byId('pay-break-enabled').checked = settings.breakEnabled;
        document.querySelectorAll('[name="pay-workdays"]').forEach((input) => {
            input.checked = settings.workdays.includes(Number(input.value));
        });
        setText('pay-error', '');
        breakFields();
    }

    function openSettings() {
        fillSettings();
        if (payDialog && !payDialog.open) payDialog.showModal();
    }

    document.querySelectorAll('[data-open-pay-settings]').forEach((button) => button.addEventListener('click', openSettings));
    on('pay-break-enabled', 'change', breakFields);
    on('pay-cancel', 'click', () => payDialog?.close());
    on('pay-close', 'click', () => payDialog?.close());
    on('pay-form', 'input', () => setText('pay-error', ''));
    on('pay-form', 'submit', (event) => {
        event.preventDefault();
        const submitted = {
            dailyPay: byId('pay-daily')?.value || '',
            start: formatTime(byId('pay-start')?.value || ''),
            end: formatTime(byId('pay-end')?.value || ''),
            breakEnabled: byId('pay-break-enabled')?.checked === true,
            breakStart: formatTime(byId('pay-break-start')?.value || ''),
            breakEnd: formatTime(byId('pay-break-end')?.value || ''),
            workdays: [...document.querySelectorAll('[name="pay-workdays"]')].filter((input) => input.checked).map((input) => Number(input.value))
        };
        const validation = salary.validateSettings(submitted);
        if (!validation.valid) {
            setText('pay-error', validation.error);
            const fields = { dailyPay: 'pay-daily', start: 'pay-start', end: 'pay-end', breakEnabled: 'pay-break-enabled', breakStart: 'pay-break-start', breakEnd: 'pay-break-end' };
            const invalid = validation.field === 'workdays' ? document.querySelector('[name="pay-workdays"]') : byId(fields[validation.field]);
            invalid?.focus();
            return;
        }
        settings = salary.normalizeSettings(submitted);
        const saved = saveStorage(payStorageKey, settings);
        renderClock();
        payDialog?.close();
        toast(saved ? '设置已保存，宠物会按你的安排陪你上班。' : '设置已应用；浏览器禁止保存，刷新后将恢复原设置。');
        clampCurrentPosition();
    });

    function savePet() {
        saveStorage(petStorageKey, pet);
    }

    function position(x, y) {
        if (desktopMode || !widget || widget.hidden) return;
        const rect = widget.getBoundingClientRect();
        const margin = 12;
        pet.x = Math.round(Math.max(margin, Math.min(x, Math.max(margin, window.innerWidth - rect.width - margin))));
        pet.y = Math.round(Math.max(margin, Math.min(y, Math.max(margin, window.innerHeight - rect.height - margin))));
        widget.style.left = `${pet.x}px`;
        widget.style.top = `${pet.y}px`;
        widget.style.right = 'auto';
        widget.style.bottom = 'auto';
    }

    function clampCurrentPosition() {
        if (desktopMode || !widget || widget.hidden) return;
        const rect = widget.getBoundingClientRect();
        position(pet.x ?? rect.left, pet.y ?? rect.top);
    }

    function renderPetState() {
        widget?.classList.toggle('is-collapsed', pet.collapsed);
        if (panel) panel.dataset.view = pet.view;
        byId('pet-collapse')?.setAttribute('aria-expanded', String(!pet.collapsed));
        byId('pet-collapse')?.setAttribute('aria-label', pet.collapsed ? '展开宠物面板' : '收起宠物面板');
        setText('pet-collapse-label', pet.collapsed ? '展开' : '收起');
        const modeLabel = pet.view === 'quote' ? '看工资' : '看鼓励';
        setText('pet-mode-label', modeLabel);
        byId('pet-mode-toggle')?.setAttribute('aria-label', modeLabel);
        byId('pet-mode-toggle')?.setAttribute('aria-pressed', String(pet.view === 'quote'));
        requestAnimationFrame(clampCurrentPosition);
    }

    on('pet-collapse', 'click', () => {
        pet.collapsed = !pet.collapsed;
        renderPetState();
        savePet();
    });
    on('pet-mode-toggle', 'click', () => {
        pet.view = pet.view === 'salary' ? 'quote' : 'salary';
        pet.collapsed = false;
        renderPetState();
        savePet();
    });
    on('pet-hide', 'click', () => {
        if (widget) widget.hidden = true;
        if (byId('pet-show')) byId('pet-show').hidden = false;
        byId('pet-show')?.setAttribute('aria-expanded', 'false');
        byId('pet-show')?.focus();
    });
    on('pet-show', 'click', () => {
        if (widget) widget.hidden = false;
        if (byId('pet-show')) byId('pet-show').hidden = true;
        byId('pet-show')?.setAttribute('aria-expanded', 'true');
        clampCurrentPosition();
        handle?.focus();
    });

    function showQuote(text) {
        if (typeof text === 'string') setText('pet-quote', text.slice(0, 500));
    }

    showQuote(byId('quote-text')?.textContent || '认真上班的你，也值得被好好照顾。');
    window.addEventListener('workday:quote', (event) => showQuote(event.detail?.text));
    on('pet-pat', 'click', () => {
        clearTimeout(happyTimeout);
        widget?.classList.add('is-happy');
        happyTimeout = setTimeout(() => widget?.classList.remove('is-happy'), 1600);
        byId('encourage-button')?.click();
        pet.view = 'quote';
        pet.collapsed = false;
        renderPetState();
        savePet();
    });

    handle?.addEventListener('pointerdown', (event) => {
        if (desktopMode || !widget || event.button !== 0 || event.isPrimary === false) return;
        const rect = widget.getBoundingClientRect();
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        try { handle.setPointerCapture(event.pointerId); } catch (_) { /* Capture can fail if the pointer has already ended. */ }
        widget.classList.add('is-dragging');
        handle.focus({ preventScroll: true });
        event.preventDefault();
    });
    handle?.addEventListener('pointermove', (event) => {
        if (!drag || drag.id !== event.pointerId) return;
        position(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
        event.preventDefault();
    });
    function stopDragging(event) {
        if (!drag || drag.id !== event.pointerId) return;
        drag = null;
        widget?.classList.remove('is-dragging');
        try { handle.releasePointerCapture(event.pointerId); } catch (_) { /* No capture remains after a canceled pointer. */ }
        savePet();
    }
    handle?.addEventListener('pointerup', stopDragging);
    handle?.addEventListener('pointercancel', stopDragging);
    handle?.addEventListener('lostpointercapture', (event) => {
        if (drag?.id === event.pointerId) {
            drag = null;
            widget?.classList.remove('is-dragging');
            savePet();
        }
    });
    handle?.addEventListener('keydown', (event) => {
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (desktopMode || !directions[event.key] || !widget) return;
        event.preventDefault();
        const rect = widget.getBoundingClientRect();
        const step = event.shiftKey ? 32 : 16;
        position(rect.left + directions[event.key][0] * step, rect.top + directions[event.key][1] * step);
        savePet();
    });

    window.addEventListener('resize', () => {
        if (desktopMode) return;
        clampCurrentPosition();
        savePet();
    });
    window.addEventListener('storage', (event) => {
        if (event.key !== payStorageKey && event.key !== null) return;
        settings = salary.normalizeSettings(readStorage(payStorageKey), readStorage('workday-club:v1'));
        renderClock();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            renderClock();
            clampCurrentPosition();
        }
    });

    renderPetState();
    renderClock();
    if (widget && !desktopMode) {
        const rect = widget.getBoundingClientRect();
        const x = pet.x ?? (petMode ? (window.innerWidth - rect.width) / 2 : window.innerWidth - rect.width - 22);
        const y = pet.y ?? (petMode ? (window.innerHeight - rect.height) / 2 : window.innerHeight - rect.height - 18);
        position(x, y);
    }
    setInterval(renderClock, 1000);
})();
