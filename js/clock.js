// часы и дата

"use strict";

const clockTime = document.querySelector(".datetime time");

const clockDate = document.querySelector(".datetime p");

// обновляем время
function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    clockTime.textContent = `${hours}:${minutes}`;
    const locale = settings.language === "ru" ? "ru-RU" : "en-GB";
    const formattedDate = new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    }).format(now);
    clockDate.textContent = formattedDate.charAt(0).toLocaleUpperCase(locale) + formattedDate.slice(1);
}

document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateClock();
});
