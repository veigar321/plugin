(() => {
    'use strict';

    const bridge = globalThis.webkit?.messageHandlers?.petNative;
    if (!bridge || typeof bridge.postMessage !== 'function') return;

    const byId = (id) => document.getElementById(id);
    const widget = byId('pet-widget');
    const handle = byId('pet-drag-handle');
    const cat = byId('pet-pat');
    const card = byId('desktop-salary-card');
    const cardHandle = byId('desktop-card-drag');
    const presentationKey = 'workday-desktop:v1';
    if (!widget) return;

    let presentation = 'card';
    try {
        const saved = JSON.parse(localStorage.getItem(presentationKey) || 'null');
        if (saved?.presentation === 'pet') presentation = 'pet';
    } catch (_) { /* The desktop card remains available without browser storage. */ }
    if (!card) presentation = 'pet';
    let lastEarned = document.querySelector('[data-pay="earned"]')?.textContent || '0.0000';

    document.documentElement.classList.add('is-desktop-pet-root');
    document.body.classList.add('is-pet-mode', 'is-desktop-pet');
    document.title = '上班鼓励器 · 陪班小橘';
    handle?.setAttribute('aria-label', '拖动顶栏，在桌面移动小橘');
    handle?.setAttribute('title', '按住拖动，在桌面移动');
    cat?.setAttribute('aria-label', '拖动小橘在桌面移动，轻点听一句鼓励');
    cat?.setAttribute('title', '拖动移动，轻点加油');
    cardHandle?.setAttribute('aria-label', '拖动上班鼓励器，在桌面移动工资卡片');
    cardHandle?.setAttribute('title', '按住拖动，在桌面移动');
    byId('pet-hide')?.setAttribute('aria-label', '退出上班鼓励器');
    byId('pet-hide')?.setAttribute('title', '退出应用');

    // A plain HH:mm:ss editor avoids WebKit's segmented time picker inside a floating panel.
    const timeInputs = ['pay-start', 'pay-end', 'pay-break-start', 'pay-break-end'].map(byId).filter(Boolean);
    function normalizeTime(input) {
        const match = /^([01]?[0-9]|2[0-3]):([0-5]?[0-9])(?::([0-5]?[0-9]))?$/.exec(input.value.trim());
        if (match) input.value = `${match[1].padStart(2, '0')}:${match[2].padStart(2, '0')}:${(match[3] || '00').padStart(2, '0')}`;
    }
    timeInputs.forEach((input) => {
        input.type = 'text';
        input.inputMode = 'text';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.maxLength = 8;
        input.placeholder = '09:00:00';
        input.setAttribute('pattern', '(?:[01]?[0-9]|2[0-3]):[0-5]?[0-9](?::[0-5]?[0-9])?');
        input.setAttribute('title', '输入24小时时间，例如08:30:15；省略秒时按00秒处理');
        input.addEventListener('focus', () => input.select());
        input.addEventListener('blur', () => normalizeTime(input));
    });
    byId('pay-form')?.addEventListener('submit', () => timeInputs.forEach(normalizeTime), true);

    let layoutFrame = null;
    let layoutTimer = null;
    let lastLayout = '';

    function send(message) {
        try {
            bridge.postMessage(message);
        } catch (_) {
            // Closing the app can invalidate the WebKit bridge before a pending observer runs.
        }
    }

    function openDialog() {
        return document.querySelector('dialog[open]');
    }

    function focusSettings() {
        const dialog = openDialog();
        if (!dialog) return;
        const active = document.activeElement;
        if (active && dialog.contains(active) && active.matches('input, textarea, select, [contenteditable="true"]')) return;
        dialog.querySelector('input:not(:disabled), textarea:not(:disabled), button')?.focus({ preventScroll: true });
    }

    function renderMoney() {
        if (presentation !== 'card' || !card || card.hidden) return;
        const amount = byId('desktop-earned');
        if (!amount) return;
        if (globalThis.WorkdayMoney) globalThis.WorkdayMoney.render(amount, lastEarned);
        else amount.textContent = lastEarned;
    }

    function applyPresentation() {
        if (card) card.hidden = presentation !== 'card';
        widget.hidden = presentation === 'card';
        document.body.classList.toggle('is-desktop-salary', presentation === 'card');
        renderMoney();
    }

    function setPresentation(value) {
        if (value !== 'card' && value !== 'pet') return;
        presentation = value === 'card' && card ? 'card' : 'pet';
        try { localStorage.setItem(presentationKey, JSON.stringify({ presentation })); } catch (_) {}
        applyPresentation();
        refreshLayout();
    }

    function fitCard() {
        if (presentation !== 'card' || !card || card.hidden) return;
        const availableHeight = Math.max(160, (Number(globalThis.screen?.availHeight) || 800) - 48);
        const availableWidth = Math.max(160, (Number(globalThis.screen?.availWidth) || 1280) - 48);
        const scale = Math.min(1, availableHeight / Math.max(1, card.offsetHeight), availableWidth / Math.max(1, card.offsetWidth));
        card.style.setProperty('--desktop-card-scale', scale.toFixed(4));
    }

    function visibleRegion(element) {
        if (!element || element.hidden) return null;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return null;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return {
            x: Math.round(rect.left * 100) / 100,
            y: Math.round(rect.top * 100) / 100,
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100
        };
    }

    function reportLayout() {
        if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
        if (layoutTimer !== null) clearTimeout(layoutTimer);
        layoutFrame = null;
        layoutTimer = null;
        const dialog = openDialog();
        fitCard();
        const active = presentation === 'card' && card ? card : widget;
        const rect = active.getBoundingClientRect();
        const availableHeight = Number(globalThis.screen?.availHeight) || 800;
        const modal = Boolean(dialog);
        const regions = modal
            ? [{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }]
            : (presentation === 'card' && card ? [card] : [widget.querySelector('.pet-toolbar'), byId('pet-panel'), cat]).map(visibleRegion).filter(Boolean);
        const dragTargets = presentation === 'card' && card
            ? [[card, false]]
            : [[handle, false], [cat, true]];
        const dragRegions = modal ? [] : dragTargets.flatMap(([element, pet]) => {
            const rect = visibleRegion(element);
            return rect ? [{ ...rect, pet }] : [];
        });
        const exclusions = modal || presentation !== 'card' || !card ? []
            : [...card.querySelectorAll('button, a, input, textarea, select, [contenteditable="true"]')]
                .filter((element) => element !== cardHandle)
                .map(visibleRegion).filter(Boolean);
        const message = {
            action: 'layout',
            presentation,
            width: modal ? 460 : Math.ceil(rect.width + 24),
            height: modal ? Math.max(280, Math.min(760, availableHeight - 40)) : Math.ceil(rect.height + 24),
            modal,
            regions,
            dragRegions,
            exclusions
        };
        const serialized = JSON.stringify(message);
        if (serialized === lastLayout) return;
        lastLayout = serialized;
        send(message);
    }

    function refreshLayout(force = false) {
        if (force === true) lastLayout = '';
        if (layoutFrame !== null || layoutTimer !== null) return;
        layoutFrame = requestAnimationFrame(reportLayout);
        // WebKit can pause animation frames while the native window is hidden.
        // A single bounded fallback also keeps its window geometry current in that state.
        layoutTimer = setTimeout(reportLayout, 100);
    }

    function collapse(collapsed) {
        if (typeof collapsed !== 'boolean') return;
        if (presentation !== 'pet') setPresentation('pet');
        if (widget.classList.contains('is-collapsed') !== collapsed) byId('pet-collapse')?.click();
        refreshLayout();
    }

    function setView(view) {
        if (view !== 'salary' && view !== 'quote') return;
        if (view === 'salary' && card) { setPresentation('card'); return; }
        setPresentation('pet');
        if (byId('pet-panel')?.dataset.view !== view) byId('pet-mode-toggle')?.click();
        collapse(false);
        refreshLayout();
    }

    function show() {
        applyPresentation();
        const launcher = byId('pet-show');
        if (launcher) launcher.hidden = true;
        refreshLayout();
    }

    function dragStarted() {
        widget.classList.add('is-dragging');
        if (presentation === 'card') card?.classList.add('is-dragging');
    }

    function dragEnded(dragged, petClick) {
        widget.classList.remove('is-dragging');
        card?.classList.remove('is-dragging');
        if (dragged === false && petClick === true && presentation === 'pet') cat?.click();
        refreshLayout(true);
    }

    window.WorkdayDesktop = Object.freeze({ dragStarted, dragEnded, show, setPresentation, setView, collapse, focusSettings, refreshLayout });

    window.addEventListener('workday:pay', (event) => {
        if (typeof event.detail?.earned !== 'string') return;
        lastEarned = event.detail.earned;
        renderMoney();
    });

    for (const element of [cat, handle, cardHandle]) {
        element?.addEventListener('click', (event) => {
            // The native drag view owns mouse gestures and dispatches a programmatic pet tap.
            if (!event.isTrusted) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
    }

    byId('pet-hide')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        send({ action: 'quit' });
    }, true);
    byId('desktop-card-close')?.addEventListener('click', () => send({ action: 'quit' }));
    const settingsDialog = byId('pay-dialog');
    settingsDialog?.addEventListener('pointerdown', (event) => {
        if (event.target.closest('input, textarea, select')) send({ action: 'focusSettings' });
    }, true);
    settingsDialog?.addEventListener('focusin', (event) => {
        if (event.target.matches('input, textarea, select')) send({ action: 'focusSettings' });
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !settingsDialog?.open) return;
        event.preventDefault();
        settingsDialog.close();
        refreshLayout();
    });

    const resizeObserver = new ResizeObserver(refreshLayout);
    resizeObserver.observe(widget);
    if (card) resizeObserver.observe(card);
    document.querySelectorAll('dialog').forEach((dialog) => resizeObserver.observe(dialog));
    const mutationObserver = new MutationObserver(refreshLayout);
    mutationObserver.observe(widget, { attributes: true, attributeFilter: ['class', 'hidden'], childList: true, subtree: true });
    if (card) mutationObserver.observe(card, { attributes: true, attributeFilter: ['class', 'hidden'], childList: true });
    document.querySelectorAll('dialog').forEach((dialog) => {
        mutationObserver.observe(dialog, { attributes: true, attributeFilter: ['open'], childList: true, subtree: true });
        dialog.addEventListener('close', refreshLayout);
        dialog.addEventListener('cancel', refreshLayout);
    });
    window.addEventListener('resize', refreshLayout);
    window.addEventListener('load', refreshLayout);
    document.fonts?.ready.then(() => { renderMoney(); refreshLayout(); }).catch(() => {});
    applyPresentation();
    refreshLayout();
})();
