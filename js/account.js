// аккаунт гугл

"use strict";

(() => {
    const link = document.querySelector(".google-account");
    const initial = link.querySelector("span");
    const gmailLink = document.querySelector(".gmail-link");
    const labels = {
        ru: {
            account: "Аккаунт Google в профиле Chrome",
            signIn: "Открыть Google аккаунт"
        },
        en: {
            account: "Google account in this Chrome profile",
            signIn: "Open Google account"
        }
    };
    let email = "";
    let requestId = 0;

    const language = () => document.documentElement.lang === "en" ? "en" : "ru";

    function accountColor(value) {
        if (!value) return "#4285f4";
        const hue = Array.from(value).reduce((total, letter) =>
            (total * 31 + letter.codePointAt(0)) % 360, 0);
        return `hsl(${hue} 58% 48%)`;
    }

    // показываем аккаунт
    function render() {
        const text = email ? `${labels[language()].account}: ${email}` : labels[language()].signIn;
        link.title = text;
        link.setAttribute("aria-label", text);
        initial.textContent = Array.from(email.split("@")[0])[0]?.toLocaleUpperCase() || "G";
        initial.hidden = false;
        link.style.setProperty("--account-color", accountColor(email));
    }

    async function load() {
        const currentRequest = ++requestId;
        let profile = null;
        try {
            profile = await globalThis.chrome?.identity?.getProfileUserInfo({ accountStatus: "ANY" });
        } catch {}
        if (currentRequest !== requestId) return;
        email = typeof profile?.email === "string" ? profile.email : "";
        const accountUrl = new URL("https://myaccount.google.com/");
        const gmailUrl = new URL("https://mail.google.com/mail/");
        if (email) {
            accountUrl.searchParams.set("authuser", email);
            gmailUrl.searchParams.set("authuser", email);
        }
        link.href = accountUrl.href;
        gmailLink.href = gmailUrl.href;
        render();
    }

    new MutationObserver(render).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lang"]
    });
    globalThis.chrome?.identity?.onSignInChanged?.addListener(load);
    render();
    load();
})();
