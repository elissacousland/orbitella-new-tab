// голосовой поиск

"use strict";

(() => {
    const button = document.querySelector('.search-form button[type="button"]');
    const message = document.querySelector(".voice-status");
    const input = document.querySelector(".search-form input");
    const form = document.querySelector(".search-form");
    const labels = {
        ru: {
            voice: "Голосовой поиск",
            stop: "Отменить голосовой поиск",
            listening: "Слушаю… Произнесите запрос.",
            starting: "Подключаем микрофон…",
            unsupported: "Голосовой поиск недоступен в этом браузере. Введите запрос с клавиатуры.",
            denied: "Разрешите доступ к микрофону в настройках браузера и попробуйте снова.",
            network: "Не удалось подключиться к распознаванию речи. Проверьте интернет.",
            audio: "Микрофон недоступен. Проверьте его подключение.",
            processing: "Завершаю распознавание…",
            service: "Сервис распознавания недоступен или запрещён браузером.",
            setup: "Настроить доступ к микрофону",
            empty: "Не удалось расслышать. Нажмите микрофон и попробуйте ещё раз.",
            error: "Не удалось распознать речь. Попробуйте ещё раз."
        },
        en: {
            voice: "Voice search",
            stop: "Cancel voice search",
            listening: "Listening… Say your search.",
            starting: "Connecting microphone…",
            unsupported: "Voice search is unavailable in this browser. Type your search instead.",
            denied: "Allow microphone access in browser settings and try again.",
            network: "Could not connect to speech recognition. Check your internet connection.",
            audio: "Microphone unavailable. Check its connection.",
            processing: "Finishing recognition…",
            service: "The speech service is unavailable or blocked by the browser.",
            setup: "Set up microphone access",
            empty: "No speech recognized. Click the microphone to try again.",
            error: "Speech recognition failed. Please try again."
        }
    };
    let session = null;
    let status = "";
    const pauseMs = 1300;
    const language = () => document.documentElement.lang === "en" ? "en" : "ru";
    const text = key => labels[language()][key];

    const setup = document.createElement("a");
    setup.className = "voice-permission-link";
    setup.hidden = true;
    message.after(setup);
    function render() {
        const label = session ? text("stop") : text("voice");
        button.title = label;
        button.setAttribute("aria-label", label);
        button.setAttribute("aria-pressed", String(Boolean(session)));
        button.dataset.voiceState = session ? (status === "listening" ? "listening" : "processing") : status ? "error" : "idle";
        message.hidden = !status;
        message.textContent = status ? text(status) : "";
        setup.hidden = status !== "denied";
        setup.textContent = text("setup");
        setup.href = `microphone.html?lang=${language()}`;
    }

    async function diagnose(stage, code = "") {
        let permission = "unknown";
        try { permission = (await navigator.permissions.query({ name: "microphone" })).state; } catch {}
        console.info("[Voice input]", { stage, code, permission, origin: location.origin,
            secureContext: window.isSecureContext, api: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition) });
    }

    function clearTimers(current) {
        clearTimeout(current.pause);
        clearTimeout(current.finish);
        clearTimeout(current.limit);
    }

    function cancel() {
        const current = session;
        session = null;
        status = "";
        if (current) {
            clearTimers(current);
            try { current.recognition.abort(); } catch {}
        }
        render();
    }

    function submit(current) {
        if (session !== current) return;
        const hasText = Boolean(current.transcript.trim());
        cancel();
        if (hasText) form.requestSubmit();
    }

    function finish(current) {
        if (session !== current) return;
        current.stopping = true;
        status = "processing";
        render();
        if (current.ended) return submit(current);
        current.finish = setTimeout(() => submit(current), 1500);
        try { current.recognition.stop(); } catch { submit(current); }
    }

    function schedule(current) {
        clearTimeout(current.pause);
        if (!current.stopping && current.transcript.trim()) {
            current.pause = setTimeout(() => finish(current), pauseMs);
        }
    }

    // запускаем распознавание
    function start() {
        if (session) return cancel();
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) {
            status = "unsupported";
            render();
            void diagnose("unsupported");
            return;
        }
        if (typeof closeSearchSuggestions === "function") closeSearchSuggestions();
        let current;
        try {
            const active = new Recognition();
            current = { recognition: active, transcript: "", ended: false, stopping: false };
            session = current;
            status = "starting";
            render();
            active.lang = language() === "ru" ? "ru-RU" : "en-US";
            active.continuous = true;
            active.interimResults = true;
            active.maxAlternatives = 1;
            active.onstart = () => {
                if (session !== current) return;
                status = "listening";
                render();
            };
            active.onspeechstart = () => {
                if (session !== current || current.stopping) return;
                clearTimeout(current.pause);
                status = "listening";
                render();
            };
            active.onspeechend = () => {
                if (session === current) schedule(current);
            };
            active.onresult = event => {
                if (session !== current) return;
                const query = Array.from(event.results, result => result[0]?.transcript || "").join(" ").trim();
                if (!query) return;
                current.transcript = query;
                input.value = query;

                schedule(current);
            };
            active.onerror = event => {
                if (session !== current) return;
                void diagnose("recognition-error", event.error);
                cancel();
                status = ({ "not-allowed": "denied", "service-not-allowed": "service",
                    network: "network", "audio-capture": "audio", "no-speech": "",
                    aborted: "", "language-not-supported": "unsupported" })[event.error] ?? "error";
                render();
            };
            active.onend = () => {
                if (session !== current) return;
                current.ended = true;
                if (current.stopping) return submit(current);
                if (!current.transcript.trim()) return cancel();
                status = "processing";
                render();
                schedule(current);
            };

            current.limit = setTimeout(cancel, 60000);
            active.start();
            void diagnose("start");
        } catch (error) {
            cancel();
            status = error.name === "NotAllowedError" ? "denied" : "error";
            render();
            void diagnose("start-error", error.name);
        }
    }

    button.addEventListener("click", start);
    form.addEventListener("submit", cancel);
    input.addEventListener("input", () => session && cancel());
    document.addEventListener("keydown", event => event.key === "Escape" && session && cancel());
    document.addEventListener("visibilitychange", () => document.hidden && session && cancel());
    document.addEventListener("dashboard-search-hidden", cancel);
    window.addEventListener("pagehide", cancel);
    new MutationObserver(() => { cancel(); }).observe(document.documentElement, {
        attributes: true, attributeFilter: ["lang"]
    });
    render();
})();
