// поиск

"use strict";

const searchForm = document.querySelector(".search-form");

const searchInput = document.querySelector(".search-form input");

const searchArea = document.querySelector(".search-area");

const searchTrigger = document.querySelector(".orbital-search-trigger");

const searchFocusOverlay = document.querySelector(".search-focus-overlay");

const searchBackgroundBookmarks = document.getElementById("bookmarks-panel");

function setOrbitalSearchExpanded(expanded, focusInput = false) {
    const nextExpanded = Boolean(expanded && settings.showSearch);
    searchArea.classList.toggle("search-area--expanded", nextExpanded);
    document.body.classList.toggle("search-focus-active", nextExpanded);
    searchForm.dataset.expanded = String(nextExpanded);
    searchForm.setAttribute("aria-expanded", String(nextExpanded));
    searchTrigger?.setAttribute("aria-expanded", String(nextExpanded));
    searchFocusOverlay?.setAttribute("aria-hidden", String(!nextExpanded));
    searchBackgroundBookmarks?.toggleAttribute("inert", nextExpanded);
    if (focusInput && nextExpanded) {
        requestAnimationFrame(() => searchInput.focus({ preventScroll: true }));
    } else if (!nextExpanded && document.activeElement === searchInput) {
        searchInput.blur();
    }
}

function applySearchVisibility() {
    searchArea.hidden = false;
    searchTrigger.hidden = !settings.showSearch;
    document.body.dataset.searchVisible = String(settings.showSearch);
    if (!settings.showSearch) {
        setOrbitalSearchExpanded(false);
        closeSearchSuggestions();
        document.dispatchEvent(new CustomEvent("dashboard-search-hidden"));
    }
}

function getDirectAddress(text) {
    if (text.startsWith("http://") || text.startsWith("https://")) {
        return isWebsite(text) ? text : null;
    }
    if (!text.includes(" ") && text.includes(".")) {
        const address = `https://${text}`;
        return isWebsite(address) ? address : null;
    }
    return null;
}

// открываем адрес или запускаем поиск
async function runSearch(text) {
    closeSearchSuggestions();
    if (!text.trim()) {
        window.location.assign("https://ya.ru/");
        return;
    }
    const address = getDirectAddress(text);
    if (address) {
        window.location.assign(address);
        return;
    }
    try {
        await saveSearchQuery(text);
        await chrome.search.query({
            text: text,
            disposition: "CURRENT_TAB"
        });
    } catch (error) {
        console.error(error);
        showNotification(translate("searchError"));
    }
}

// подключаем поиск
function initSearch() {
    setOrbitalSearchExpanded(false);
    searchTrigger?.addEventListener("click", function(event) {
        event.preventDefault();
        const willOpen = !searchArea.classList.contains("search-area--expanded");
        if (!willOpen) closeSearchSuggestions();
        setOrbitalSearchExpanded(willOpen, willOpen);
    });
    searchInput.addEventListener("focus", () => setOrbitalSearchExpanded(true));
    searchForm.addEventListener("submit", function(event) {
        event.preventDefault();
        const text = searchInput.value.trim();
        runSearch(text);
    });
    document.addEventListener("click", function(event) {
        if (!searchArea.classList.contains("search-area--expanded") || searchArea.contains(event.target)) return;
        closeSearchSuggestions();
        setOrbitalSearchExpanded(false);
    });
    document.addEventListener("keydown", function(event) {
        if (settings.showSearch && event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey &&
            !event.target.closest("input, textarea, select, [contenteditable=true]")) {
            event.preventDefault();
            setOrbitalSearchExpanded(true, true);
        }
        if (event.key === "Escape" && searchArea.classList.contains("search-area--expanded")) {
            event.preventDefault();
            closeSearchSuggestions();
            setOrbitalSearchExpanded(false);
        }
    });
}
