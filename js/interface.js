// общие элементы интерфейса

"use strict";

let notificationTimer;

const notification = document.querySelector(".toast");

const customSelects = new Map();

function closeCustomSelects(except = null) {
    customSelects.forEach(function(parts) {
        if (parts.wrapper !== except) {
            parts.wrapper.classList.remove("is-open");
            parts.button.setAttribute("aria-expanded", "false");
            parts.list.hidden = true;
        }
    });
}

function positionCustomSelect(parts) {
    const rect = parts.button.getBoundingClientRect();
    const dialog = parts.button.closest("dialog");
    const limits = dialog?.getBoundingClientRect() || {
        top: 0,
        bottom: window.innerHeight
    };
    const spaceBelow = limits.bottom - rect.bottom - 12;
    const spaceAbove = rect.top - limits.top - 12;
    const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    parts.list.style.left = "0";
    parts.list.style.width = "100%";
    parts.list.style.maxHeight = `${Math.max(100, openAbove ? spaceAbove : spaceBelow)}px`;
    parts.list.style.top = openAbove ? "auto" : "calc(100% + 6px)";
    parts.list.style.bottom = openAbove ? "calc(100% + 6px)" : "auto";
}

function refreshCustomSelect(select) {
    const parts = customSelects.get(select);
    if (!parts) {
        return;
    }
    const selected = select.options[select.selectedIndex];
    parts.button.textContent = selected?.textContent || "";
    const labelText = parts.label?.textContent.trim();
    parts.button.setAttribute("aria-label", labelText ?
        `${labelText}: ${parts.button.textContent}` : parts.button.textContent);
    parts.list.replaceChildren(...Array.from(select.options, function(option) {
        const item = document.createElement("button");
        item.type = "button";
        item.textContent = option.textContent;
        item.dataset.value = option.value;
        item.disabled = option.disabled;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(option.selected));
        item.addEventListener("click", function() {
            select.value = option.value;
            select.dispatchEvent(new Event("change", {
                bubbles: true
            }));
            refreshCustomSelect(select);
            closeCustomSelects();
            parts.button.focus();
        });
        return item;
    }));
}

function refreshCustomSelects() {
    customSelects.forEach(function(parts, select) {
        refreshCustomSelect(select);
    });
}

function openCustomSelect(select) {
    const parts = customSelects.get(select);
    const willOpen = parts.list.hidden;
    closeCustomSelects(parts.wrapper);
    parts.wrapper.classList.toggle("is-open", willOpen);
    parts.button.setAttribute("aria-expanded", String(willOpen));
    parts.list.hidden = !willOpen;
    if (willOpen) {
        positionCustomSelect(parts);
    }
}

// настраиваем выпадающие списки
function initCustomSelects() {
    document.querySelectorAll("dialog select").forEach(function(select, index) {
        const wrapper = document.createElement("div");
        wrapper.className = "custom-select";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "custom-select-button";
        button.setAttribute("aria-haspopup", "listbox");
        button.setAttribute("aria-expanded", "false");
        const list = document.createElement("div");
        list.className = "custom-select-list";
        list.id = `custom-select-${index}`;
        list.setAttribute("role", "listbox");
        list.hidden = true;
        button.setAttribute("aria-controls", list.id);
        select.before(wrapper);
        wrapper.append(select, button, list);
        select.classList.add("native-select");
        select.tabIndex = -1;
        const label = document.querySelector(`label[for="${select.id}"]`);
        const parts = {
            wrapper: wrapper,
            button: button,
            list: list,
            label: label
        };
        customSelects.set(select, parts);
        refreshCustomSelect(select);
        button.addEventListener("click", function() {
            openCustomSelect(select);
        });
        button.addEventListener("keydown", function(event) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                openCustomSelect(select);
                const options = Array.from(list.querySelectorAll("button:not(:disabled)"));
                const selectedOption = options.find(option => option.getAttribute("aria-selected") === "true");
                (selectedOption || options[0])?.focus();
            }
        });
        list.addEventListener("keydown", function(event) {
            const options = Array.from(list.querySelectorAll("button:not(:disabled)"));
            const current = options.indexOf(document.activeElement);
            if (event.key === "Escape") {
                event.preventDefault();
                closeCustomSelects();
                button.focus();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                options[(current + step + options.length) % options.length]?.focus();
            }
        });
        select.addEventListener("change", function() {
            refreshCustomSelect(select);
        });
        new MutationObserver(function() {
            refreshCustomSelect(select);
        }).observe(select, {
            childList: true,
            subtree: true,
            characterData: true
        });
        label?.addEventListener("click", function(event) {
            event.preventDefault();
            button.focus();
        });
    });
    document.addEventListener("pointerdown", function(event) {
        if (!event.target.closest(".custom-select") && !event.target.closest(".custom-select-list")) {
            closeCustomSelects();
        }
    });
    window.addEventListener("resize", closeCustomSelects);
    document.addEventListener("scroll", closeCustomSelects, true);
}

// показываем уведомление
function showNotification(message) {
    (document.querySelector("dialog[open]") || document.body).append(notification);
    clearTimeout(notificationTimer);
    notification.textContent = message;
    notification.hidden = false;
    notificationTimer = setTimeout(function() {
        notification.hidden = true;
    }, 3000);
}

function isWebsite(url) {
    try {
        const parsedUrl = new URL(url);
        return (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:");
    } catch {
        return false;
    }
}

function normalizeWebsiteUrl(value) {
    const enteredUrl = String(value || "").trim();
    const completeUrl = enteredUrl.startsWith("http://") || enteredUrl.startsWith("https://") ?
        enteredUrl : `https://${enteredUrl}`;
    return isWebsite(completeUrl) ? completeUrl : null;
}

// закрываем диалоги
function initDialogs() {
    document.querySelectorAll("[data-close]").forEach(function(button) {
        button.addEventListener("click", function() {
            const dialog = button.closest("dialog");
            dialog.close();
        });
    });
}
