// подсказки поиска

"use strict";

const searchSuggestions = document.querySelector(".search-suggestions");
let savedSearches = [];
let suggestions = [];
let selectedSuggestion = -1;
let suggestionsTimer;
let suggestionsRequest = 0;

function closeSearchSuggestions() {
    clearTimeout(suggestionsTimer);
    suggestionsRequest++;
    searchSuggestions.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.removeAttribute("aria-activedescendant");
    selectedSuggestion = -1;
}

async function saveSearchQuery(text) {
    if (chrome.extension?.inIncognitoContext) {
        return;
    }
    savedSearches = savedSearches.filter(query => query.toLowerCase() !== text.toLowerCase());
    savedSearches.unshift(text);
    savedSearches = savedSearches.slice(0, 50);
    try {
        await chrome.storage.local.set({ dashboardSearches: savedSearches });
    } catch {

    }
}

function getSuggestionLabel(type) {
    const labels = {
        query: ["Недавний запрос", "Recent search"],
        bookmark: ["Закладка", "Bookmark"],
        history: ["История", "History"]
    };
    return labels[type][settings.language === "en" ? 1 : 0];
}

function renderSearchSuggestions() {
    searchSuggestions.replaceChildren();
    selectedSuggestion = -1;
    searchInput.removeAttribute("aria-activedescendant");
    searchSuggestions.setAttribute("aria-label", settings.language === "en" ? "Search suggestions" : "Подсказки поиска");

    suggestions.forEach(function(suggestion, index) {
        const item = document.createElement("li");
        item.id = "search-option-" + index;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");

        const title = document.createElement("span");
        title.textContent = suggestion.title;
        const description = document.createElement("small");
        description.textContent = getSuggestionLabel(suggestion.type);
        if (suggestion.url) {
            description.textContent += " · " + new URL(suggestion.url).hostname;
        }
        item.append(title, description);
        item.addEventListener("mousedown", event => event.preventDefault());
        item.addEventListener("click", () => openSearchSuggestion(index));
        searchSuggestions.append(item);
    });

    searchSuggestions.hidden = suggestions.length === 0;
    searchInput.setAttribute("aria-expanded", String(suggestions.length > 0));
}

// собираем подсказки
async function loadSearchSuggestions() {
    const text = searchInput.value.trim().toLowerCase();
    const requestNumber = ++suggestionsRequest;
    if (!text) {
        closeSearchSuggestions();
        return;
    }

    const matches = [];
    const seen = new Set();

    function addSuggestion(title, url, type) {
        if (url && !isWebsite(url)) {
            return;
        }
        if (!(title + " " + (url || "")).toLowerCase().includes(text)) {
            return;
        }
        const key = url ? new URL(url).href : title.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        matches.push({ title: title || url, url: url, type: type });
    }

    savedSearches.forEach(query => addSuggestion(query, null, "query"));
    bookmarkIndex.forEach(function(bookmark) {
        if (bookmark.url) {
            addSuggestion(bookmark.title, bookmark.url, "bookmark");
        }
    });

    try {
        const history = await chrome.history.search({ text: text, startTime: 0, maxResults: 30 });
        history.sort((first, second) => second.lastVisitTime - first.lastVisitTime);
        history.forEach(page => addSuggestion(page.title || page.url, page.url, "history"));
    } catch {

    }

    if (requestNumber !== suggestionsRequest || document.activeElement !== searchInput) {
        return;
    }
    suggestions = matches.slice(0, 7);
    renderSearchSuggestions();
}

function openSearchSuggestion(index) {
    const suggestion = suggestions[index];
    if (!suggestion) {
        return;
    }
    searchInput.value = suggestion.url || suggestion.title;
    closeSearchSuggestions();
    searchForm.requestSubmit();
}

function selectSearchSuggestion(index) {
    selectedSuggestion = index;
    Array.from(searchSuggestions.children).forEach(function(item, itemIndex) {
        const selected = itemIndex === index;
        item.classList.toggle("selected", selected);
        item.setAttribute("aria-selected", String(selected));
        if (selected) {
            searchInput.setAttribute("aria-activedescendant", item.id);
            item.scrollIntoView({ block: "nearest" });
        }
    });
}

function handleSearchKeys(event) {
    if (event.isComposing) {
        return;
    }
    if (event.key === "Escape") {
        closeSearchSuggestions();
        return;
    }
    if (searchSuggestions.hidden) {
        return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        let next = selectedSuggestion + (event.key === "ArrowDown" ? 1 : -1);
        if (next < 0) {
            next = suggestions.length - 1;
        }
        selectSearchSuggestion(next % suggestions.length);
    }
    if (event.key === "Enter" && selectedSuggestion >= 0) {
        event.preventDefault();
        openSearchSuggestion(selectedSuggestion);
    }
}

// подключаем подсказки
async function initSearchSuggestions() {
    try {
        const saved = await chrome.storage.local.get("dashboardSearches");
        if (Array.isArray(saved.dashboardSearches) && !chrome.extension?.inIncognitoContext) {
            savedSearches = saved.dashboardSearches.filter(query => typeof query === "string").slice(0, 50);
        }
    } catch {

    }

    searchInput.addEventListener("input", function() {
        closeSearchSuggestions();
        suggestionsTimer = setTimeout(loadSearchSuggestions, 150);
    });
    searchInput.addEventListener("focus", loadSearchSuggestions);
    searchInput.addEventListener("keydown", handleSearchKeys);
    searchInput.addEventListener("blur", closeSearchSuggestions);
    searchForm.addEventListener("submit", closeSearchSuggestions);
    new MutationObserver(closeSearchSuggestions).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lang"]
    });
}

initSearchSuggestions();
