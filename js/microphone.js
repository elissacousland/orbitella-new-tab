// доступ к микрофону

"use strict";

(() => {
    const en = new URLSearchParams(location.search).get("lang") === "en";
    document.documentElement.lang = en ? "en" : "ru";
    const copy = en ? {
        title: "Microphone access",
        instructions: "Click the button and allow microphone access. The microphone is immediately released after this check. Then return to the main page and click the microphone to speak.",
        request: "Allow microphone", settings: "Open Chrome microphone settings", back: "Return to main page",
        pending: "Waiting for the browser permission…", granted: "Microphone access is available. You can return to the main page.",
        denied: "Chrome or the operating system blocked microphone access. In Chrome microphone settings, remove the blocked entry for this extension and enable permission requests. Also check Windows microphone access for desktop apps, then try again.",
        audio: "Microphone unavailable or busy. Check the device and try again.",
        unsupported: "Microphone access is unavailable in this browser context.", error: "Could not check the microphone. See the diagnostic code below."
    } : {
        title: "Доступ к микрофону",
        instructions: "Нажмите кнопку и разрешите доступ к микрофону. После проверки микрофон сразу отключится. Затем вернитесь на главную страницу и нажмите значок микрофона для ввода речи.",
        request: "Разрешить микрофон", settings: "Открыть настройки микрофона Chrome", back: "Вернуться на главную",
        pending: "Ожидаем разрешение браузера…", granted: "Доступ к микрофону получен. Можно вернуться на главную страницу.",
        denied: "Chrome или система блокирует микрофон. В настройках микрофона Chrome удалите запрет для этого расширения и разрешите запросы доступа. Также проверьте доступ классических приложений к микрофону в Windows, затем повторите попытку.",
        audio: "Микрофон недоступен или занят. Проверьте устройство и повторите попытку.",
        unsupported: "Доступ к микрофону недоступен в этом контексте браузера.", error: "Не удалось проверить микрофон. Диагностический код указан ниже."
    };
    const button = document.getElementById("request-microphone");
    const settingsButton = document.getElementById("microphone-settings");
    const status = document.getElementById("permission-status");
    document.querySelector("h1").textContent = copy.title;
    document.getElementById("instructions").textContent = copy.instructions;
    button.textContent = copy.request;
    settingsButton.textContent = copy.settings;
    document.getElementById("return-home").textContent = copy.back;
    let leaving = false;
    window.addEventListener("pagehide", () => { leaving = true; });

    // запрашиваем доступ
    button.addEventListener("click", async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            status.textContent = copy.unsupported;
            return;
        }
        button.disabled = true;
        status.textContent = copy.pending;
        settingsButton.hidden = true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            if (!leaving) status.textContent = copy.granted;
        } catch (error) {
            let permission = "unknown";
            try { permission = (await navigator.permissions.query({ name: "microphone" })).state; } catch {}
            console.info("[Voice permission]", { code: error.name, permission, origin: location.origin });
            const denied = ["NotAllowedError", "SecurityError"].includes(error.name);
            const audio = ["NotFoundError", "NotReadableError", "AbortError"].includes(error.name);
            status.textContent = `${denied ? copy.denied : audio ? copy.audio : copy.error} (${error.name}; ${permission})`;
            settingsButton.hidden = !denied;
        } finally {
            button.disabled = false;
        }
    });

    settingsButton.addEventListener("click", () => {
        chrome.tabs.create({ url: "chrome://settings/content/microphone" });
    });
})();
