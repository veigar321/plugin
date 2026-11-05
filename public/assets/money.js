(function (root) {
    'use strict';

    const states = new WeakMap();
    const duration = 520;

    function format(value) {
        if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim()))) return '0.0000';
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? Math.min(number, 1000000).toFixed(4) : '0.0000';
    }

    function fit(element, text) {
        const row = element.parentElement;
        const width = row?.clientWidth || 0;
        let size = 64;
        if (width > 0) {
            const currency = row.querySelector('.desktop-income-currency');
            const currencyWidth = currency?.offsetWidth || currency?.getBoundingClientRect().width || 24;
            const style = typeof root.getComputedStyle === 'function' ? root.getComputedStyle(row) : null;
            const gap = Number.parseFloat(style?.columnGap || style?.gap) || 8;
            const units = [...text].reduce((sum, character) => sum + (character === '.' ? 0.25 : 0.61), 0);
            size = Math.max(28, Math.min(72, Math.floor((width - currencyWidth - gap - 2) / units)));
        }
        element.style.setProperty('--money-font-size', `${size}px`);
        element.style.fontSize = `${size}px`;
    }

    function snap(element, columns) {
        columns.forEach((column) => {
            column.strip.classList.add('is-instant');
            column.strip.style.transform = `translateY(-${column.value}em)`;
        });
        // Commit all baselines together, including when a carry has used the duplicate digits.
        void element.offsetHeight;
        columns.forEach((column) => column.strip.classList.remove('is-instant'));
    }

    function createColumns(element, text, previousText, animate) {
        const doc = element.ownerDocument || root.document;
        const oldDigits = (previousText || '').replace('.', '');
        const newDigits = text.replace('.', '');
        const padding = newDigits.length - oldDigits.length;
        const columns = [];
        const nodes = [];
        let index = 0;
        for (const character of text) {
            if (character === '.') {
                const separator = doc.createElement('span');
                separator.className = 'money-separator';
                separator.textContent = '.';
                separator.setAttribute('aria-hidden', 'true');
                nodes.push(separator);
                continue;
            }
            const digit = doc.createElement('span');
            digit.className = 'money-digit';
            digit.setAttribute('aria-hidden', 'true');
            const strip = doc.createElement('span');
            strip.className = 'money-strip is-instant';
            for (let cell = 0; cell < 20; cell += 1) {
                const node = doc.createElement('span');
                node.className = 'money-cell';
                node.textContent = String(cell % 10);
                strip.appendChild(node);
            }
            const old = index >= padding ? Number(oldDigits[index - padding]) : 0;
            const value = animate && Number.isInteger(old) ? old : Number(character);
            strip.style.transform = `translateY(-${value}em)`;
            digit.appendChild(strip);
            nodes.push(digit);
            columns.push({ strip, value });
            index += 1;
        }
        element.replaceChildren(...nodes);
        snap(element, columns);
        return columns;
    }

    function render(element, value) {
        if (!element || typeof element.replaceChildren !== 'function') return;
        const text = format(value);
        fit(element, text);
        element.setAttribute('role', 'img');
        element.setAttribute('aria-label', `今日已赚 ¥${text}（估算）`);
        let state = states.get(element);
        if (state?.text === text) return;
        const reducedMotion = typeof root.matchMedia === 'function' && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const animate = Boolean(state) && Number(text) > Number(state.text) && !reducedMotion;
        if (state) {
            root.clearTimeout(state.timer);
            snap(element, state.columns);
        } else {
            state = { text: '', columns: [], timer: null, revision: 0 };
            states.set(element, state);
        }
        state.revision += 1;
        const revision = state.revision;
        if (state.text.length !== text.length || !state.columns.length) {
            state.columns = createColumns(element, text, state.text, animate);
        }
        const digits = text.replace('.', '');
        let wrapped = false;
        state.columns.forEach((column, index) => {
            const next = Number(digits[index]);
            const target = animate && next < column.value ? next + 10 : next;
            column.strip.classList.toggle('is-instant', !animate);
            column.strip.style.transform = `translateY(-${target}em)`;
            if (target >= 10) wrapped = true;
            column.value = next;
        });
        state.text = text;
        if (!animate) {
            snap(element, state.columns);
        } else if (wrapped) {
            state.timer = root.setTimeout(() => {
                if (states.get(element) === state && state.revision === revision) snap(element, state.columns);
                state.timer = null;
            }, duration);
        }
    }

    const api = Object.freeze({ render, format });
    root.WorkdayMoney = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
