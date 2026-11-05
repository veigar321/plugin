(() => {
    'use strict';

    const storageKey = 'workday-club:v1';
    const moods = ['tired', 'unmotivated', 'overwhelmed', 'good'];
    const taskNames = ['water', 'stretch', 'eyes'];
    const quotes = {
        tired: [
            ['你不必一直发光，\n也可以只是好好存在。', '电量低的时候，照顾好自己也是正经事。'],
            ['慢一点没关系，\n你已经走了很远。', '先喝口水，今天也可以按自己的节奏来。'],
            ['今天的你，\n已经很棒了。', '认真生活本来就很费力，给自己一点掌声。'],
            ['休息不是掉队，\n是给自己续航。', '眼睛离开屏幕一会儿，世界不会因此停转。'],
            ['不用把每一天，\n都过成满分。', '能平安地完成今天，就是一件了不起的事。']
        ],
        unmotivated: [
            ['先做一小步，\n答案会慢慢清楚。', '打开文档、写下第一行，都算一个漂亮的开始。'],
            ['不用等状态满格，\n两分钟也能出发。', '挑一件最小的事，给今天一个温柔的起点。'],
            ['今天的进度条，\n由你自己定义。', '哪怕只前进一点点，也值得被看见。'],
            ['把大大的难题，\n拆成小小的现在。', '先完成眼前这一件，剩下的等会儿再说。'],
            ['你不是没有动力，\n只是需要一点启动时间。', '别急着责怪自己，慢热也有自己的节奏。']
        ],
        overwhelmed: [
            ['事情可以一件件做，\n你可以一口口呼吸。', '先把肩膀放下来，眼前只留最重要的一件事。'],
            ['待办很多，\n你也依然很重要。', '别在照顾所有事情的时候，忘记照顾自己。'],
            ['不必一个人，\n扛住所有的事情。', '说一句“我需要一点帮助”，也是一种能力。'],
            ['这一刻有点难，\n不代表你不够好。', '复杂的事需要时间，你已经在努力解决了。'],
            ['先给心情松绑，\n再给任务排序。', '深呼吸一下，紧急的声音未必都是你的责任。']
        ],
        good: [
            ['状态不错的你，\n今天也闪闪发光。', '记住此刻的小小顺利，它值得被好好收藏。'],
            ['你的认真，\n正在悄悄开花。', '那些看起来普通的坚持，都在积攒自己的力量。'],
            ['今天的小进步，\n就是明天的底气。', '做得不错！别忘了把这句夸奖也送给自己。'],
            ['把好心情装进口袋，\n带着它轻松向前。', '完成一件事，就给自己一个小小的庆祝。'],
            ['你值得好事发生，\n也值得好好下班。', '趁着状态好做点喜欢的事，也给休息留点位置。']
        ]
    };

    const byId = (id) => document.getElementById(id);
    const localDay = (date = new Date()) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    const validTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    const minutesOf = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const setText = (id, value) => {
        const element = byId(id);
        if (element && element.textContent !== String(value)) element.textContent = value;
    };
    const on = (id, event, handler) => byId(id)?.addEventListener(event, handler);

    function readState() {
        let saved = {};
        try {
            const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
        } catch (_) {
            // The page remains usable when storage is unavailable or damaged.
        }

        const start = validTime(saved.start) ? saved.start : '09:00';
        const end = validTime(saved.end) && minutesOf(saved.end) > minutesOf(start) ? saved.end : '18:00';
        const validShift = minutesOf(start) < minutesOf(end);
        const isToday = saved.day === localDay();
        const favorites = Array.isArray(saved.favorites)
            ? [...new Set(saved.favorites.filter((text) => typeof text === 'string' && text.length > 0 && text.length <= 300))].slice(0, 100)
            : [];

        return {
            day: localDay(),
            mood: moods.includes(saved.mood) ? saved.mood : 'tired',
            start: validShift ? start : '09:00',
            end: validShift ? end : '18:00',
            count: isToday && Number.isSafeInteger(saved.count) && saved.count >= 0 ? Math.min(saved.count, 99999) : 0,
            tasks: isToday && Array.isArray(saved.tasks) ? [...new Set(saved.tasks.filter((task) => taskNames.includes(task)))] : [],
            note: isToday && typeof saved.note === 'string' ? saved.note.slice(0, 180) : '',
            favorites
        };
    }

    let state = readState();
    let currentQuote = null;
    let toastTimeout;
    let breathTimeout;

    function persist() {
        try {
            localStorage.setItem(storageKey, JSON.stringify(state));
        } catch (_) {
            // Keep the current session functional in private/restricted browsers.
        }
    }

    function toast(message) {
        const element = byId('toast');
        if (!element) return;
        clearTimeout(toastTimeout);
        element.textContent = message;
        element.classList.add('is-visible');
        toastTimeout = setTimeout(() => element.classList.remove('is-visible'), 2800);
    }

    function renderFavorite() {
        const saved = Boolean(currentQuote && state.favorites.includes(currentQuote[0]));
        const button = byId('favorite-button');
        button?.classList.toggle('is-active', saved);
        button?.setAttribute('aria-pressed', String(saved));
        button?.setAttribute('aria-label', saved ? '取消收藏这句鼓励' : '收藏这句鼓励');
        button?.setAttribute('title', saved ? '取消收藏这句鼓励' : '收藏这句鼓励');
        setText('saved-count', state.favorites.length);
        renderSavedQuotes();
    }

    function renderSavedQuotes() {
        const list = byId('saved-list');
        if (!list) return;
        list.replaceChildren();
        if (byId('saved-empty')) byId('saved-empty').hidden = state.favorites.length > 0;
        state.favorites.forEach((text) => {
            const item = document.createElement('article');
            item.className = 'saved-item';
            const quote = document.createElement('p');
            quote.className = 'saved-quote';
            quote.textContent = text;
            quote.style.whiteSpace = 'pre-line';
            item.appendChild(quote);

            const original = Object.values(quotes).flat().find((entry) => entry[0] === text);
            if (original) {
                const note = document.createElement('p');
                note.textContent = original[1];
                item.appendChild(note);
            }

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'saved-remove text-button';
            remove.textContent = '取消收藏';
            remove.setAttribute('aria-label', `取消收藏：${text.replace(/\n/g, '')}`);
            remove.addEventListener('click', () => {
                state.favorites = state.favorites.filter((savedText) => savedText !== text);
                persist();
                renderFavorite();
                const nextButton = list.querySelector('button');
                (nextButton || byId('saved-close'))?.focus();
            });
            item.appendChild(remove);
            list.appendChild(item);
        });
    }

    function renderDaily() {
        setText('encourage-count', state.count);
        document.querySelectorAll('[data-task]').forEach((input) => {
            input.checked = state.tasks.includes(input.dataset.task);
            input.closest('label')?.classList.toggle('is-complete', input.checked);
        });
        setText('task-count', `${state.tasks.length}/3`);
        const progress = byId('task-progress');
        if (progress) progress.value = state.tasks.length;
        setText('kindness-note', state.note || '比如，路上的阳光刚刚好，\n或是喝到了喜欢的那杯咖啡。');
        setText('kindness-button-label', state.note ? '编辑今天的小美好' : '记下今天的小美好');
        byId('kindness-note')?.classList.toggle('has-note', Boolean(state.note));
    }

    function checkNewDay(now = new Date()) {
        const day = localDay(now);
        if (day === state.day) return;
        state.day = day;
        state.count = 0;
        state.tasks = [];
        state.note = '';
        persist();
        renderDaily();
    }

    function chooseQuote(countInteraction = false) {
        checkNewDay();
        const available = quotes[state.mood].filter((quote) => quote[0] !== currentQuote?.[0]);
        currentQuote = available[Math.floor(Math.random() * available.length)];
        setText('quote-text', currentQuote[0]);
        setText('quote-note', currentQuote[1]);
        window.dispatchEvent(new CustomEvent('workday:quote', { detail: { text: currentQuote[0], note: currentQuote[1] } }));
        if (countInteraction) state.count = Math.min(state.count + 1, 99999);
        setText('encourage-count', state.count);
        renderFavorite();
        persist();
    }

    function renderMood() {
        document.querySelectorAll('[data-mood]').forEach((button) => {
            const selected = button.dataset.mood === state.mood;
            button.classList.toggle('is-active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });
    }

    function updateClock() {
        const now = new Date();
        checkNewDay(now);
        setText('today-date', now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }));
    }

    function openDialog(id) {
        const dialog = byId(id);
        if (dialog && !dialog.open) dialog.showModal();
    }

    function closeDialog(id) {
        byId(id)?.close();
    }

    document.querySelectorAll('[data-mood]').forEach((button) => {
        button.addEventListener('click', () => {
            if (!moods.includes(button.dataset.mood)) return;
            state.mood = button.dataset.mood;
            renderMood();
            chooseQuote();
        });
    });

    on('encourage-button', 'click', () => chooseQuote(true));

    on('saved-button', 'click', () => {
        renderSavedQuotes();
        openDialog('saved-dialog');
    });
    on('saved-close', 'click', () => closeDialog('saved-dialog'));

    on('favorite-button', 'click', () => {
        if (!currentQuote) return;
        const text = currentQuote[0];
        if (state.favorites.includes(text)) {
            state.favorites = state.favorites.filter((quote) => quote !== text);
            toast('已取消收藏，这份鼓励仍然属于你。');
        } else {
            state.favorites.push(text);
            toast('收藏好了，给未来的自己留一点能量。');
        }
        persist();
        renderFavorite();
    });

    on('copy-button', 'click', async () => {
        if (!currentQuote) return;
        const text = `${currentQuote[0].replace(/\n/g, '')}\n${currentQuote[1]}\n—— 打工能量站`;
        try {
            if (navigator.clipboard?.writeText && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const field = document.createElement('textarea');
                field.value = text;
                field.style.cssText = 'position:fixed;left:-9999px;top:0';
                document.body.appendChild(field);
                field.select();
                const copied = document.execCommand('copy');
                field.remove();
                byId('copy-button')?.focus();
                if (!copied) throw new Error('copy failed');
            }
            toast('已复制，把这份能量也送给朋友吧。');
        } catch (_) {
            toast('复制暂时不可用，可以长按选中鼓励语。');
        }
    });

    document.querySelectorAll('[data-task]').forEach((input) => {
        input.addEventListener('change', () => {
            const checked = input.checked;
            checkNewDay();
            const task = input.dataset.task;
            if (!taskNames.includes(task)) return;
            state.tasks = state.tasks.filter((name) => name !== task);
            if (checked) state.tasks.push(task);
            persist();
            renderDaily();
            if (state.tasks.length === 3) toast('今日自我照顾达成！谢谢你好好照顾自己。');
        });
    });

    on('kindness-button', 'click', () => {
        checkNewDay();
        if (byId('kindness-input')) {
            byId('kindness-input').value = state.note;
            byId('kindness-input').setCustomValidity('');
        }
        openDialog('kindness-dialog');
    });
    on('kindness-cancel', 'click', () => closeDialog('kindness-dialog'));
    on('kindness-input', 'input', () => byId('kindness-input')?.setCustomValidity(''));
    on('kindness-form', 'submit', (event) => {
        event.preventDefault();
        checkNewDay();
        const note = (byId('kindness-input')?.value || '').trim().slice(0, 180);
        if (!note) {
            byId('kindness-input')?.setCustomValidity('写下一件让你开心的小事吧，几个字也可以。');
            byId('kindness-input')?.reportValidity();
            return;
        }
        state.note = note;
        persist();
        renderDaily();
        closeDialog('kindness-dialog');
        toast('这份小确幸，替你记住啦。');
    });
    on('kindness-clear', 'click', () => {
        checkNewDay();
        state.note = '';
        persist();
        renderDaily();
        closeDialog('kindness-dialog');
        toast('已清空，新的小确幸还在路上。');
    });

    function stopBreathing() {
        clearTimeout(breathTimeout);
        byId('breath-orb')?.classList.remove('is-expanded');
    }

    function startBreathing() {
        stopBreathing();
        openDialog('breath-dialog');
        let phase = 0;
        function nextPhase() {
            if (!byId('breath-dialog')?.open) return;
            if (phase >= 6) {
                setText('breath-label', '做得很好，带着轻松继续吧。');
                byId('breath-orb')?.classList.remove('is-expanded');
                return;
            }
            const inhale = phase % 2 === 0;
            setText('breath-label', `${inhale ? '慢慢吸气' : '缓缓呼气'} · 第 ${Math.floor(phase / 2) + 1} / 3 轮`);
            byId('breath-orb')?.classList.toggle('is-expanded', inhale);
            phase += 1;
            breathTimeout = setTimeout(nextPhase, 4000);
        }
        // Let the initial circle paint before the first expansion begins.
        setText('breath-label', '放松肩膀，跟着圆圈慢慢呼吸。');
        breathTimeout = setTimeout(nextPhase, 150);
    }

    on('breath-button', 'click', startBreathing);
    on('breath-close', 'click', () => {
        stopBreathing();
        closeDialog('breath-dialog');
    });
    on('breath-dialog', 'cancel', stopBreathing);
    on('breath-dialog', 'close', stopBreathing);

    renderMood();
    renderDaily();
    chooseQuote();
    updateClock();
    setInterval(updateClock, 1000);
})();
