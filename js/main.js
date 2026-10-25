// запуск дашборда

"use strict";

document.title = "Orbitella";

let dashboardRevealed = false;

function revealDashboard() {
    if (dashboardRevealed) {
        return;
    }
    dashboardRevealed = true;
    document.documentElement.classList.remove("dashboard-loading");
}

function waitForInitialTiles() {
    const pendingImages = [...bookmarkGrid.querySelectorAll("img")].filter(image => !image.complete);
    const loaded = Promise.all(pendingImages.map(image => new Promise(resolve => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
    })));
    const iconsReady = Promise.all([loaded, waitForPendingFaviconUpgrades()]);
    const timeout = new Promise(resolve => setTimeout(resolve, 360));
    return Promise.race([iconsReady, timeout]);
}

const dashboardRevealFallback = setTimeout(revealDashboard, 700);

// запускаем интерфейс
async function initDashboard() {
    try {
        await loadDashboardSettings();
        initCustomSelects();
        fillSettingsForm();
        applyLanguage();
        applySearchVisibility();
        applyBookmarksVisibility();
        applyBookmarkTitlesVisibility();
        initSettings();
        initDialogs();
        initSearch();
        initBookmarkButtons();
        await loadBookmarks();
        await waitForInitialTiles();
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        setInterval(updateClock, 1000);
    } finally {
        clearTimeout(dashboardRevealFallback);
        revealDashboard();
    }
}

initDashboard();
