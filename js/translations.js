// переводы интерфейса

"use strict";

const translations = {
    ru: {
        addItem: "Добавить закладку или папку",
        chooseWhat: "Что добавить?",
        addFolderHeading: "Новая папка",
        bookmarkType: "Закладка",
        folderType: "Папка",
        parentFolder: "Папка в Chrome",
        deleteFolder: "Удалить папку",
        deleteAction: "Удалить",
        confirmDeleteFolder: "Удалить папку «{title}» вместе со всеми вложенными закладками из Chrome?",
        settings: "Настройки",
        openCalendar: "Открыть Google Календарь",
        deleteBookmark: "Удалить закладку",
        editBookmark: "Изменить",
        editBookmarkHeading: "Изменить закладку",
        editFolderHeading: "Изменить папку",
        folderColor: "Цвет папки",
        folderColorAmber: "Абрикосовый",
        folderColorMint: "Голубой",
        folderColorViolet: "Лавандовый",
        showBookmarkTitle: "Показывать название на плитке",
        save: "Сохранить",
        editError: "Не удалось изменить закладку в Chrome.",
        deleteError: "Не удалось удалить закладку из Chrome.",
        back: "Назад",
        close: "Закрыть",
        language: "Язык интерфейса",
        display: "Отображение",
        showSearch: "Показывать поиск",
        showBookmarks: "Показывать закладки",
        showBookmarkTitles: "Показывать названия закладок",
        tileSize: "Размер плиток",
        small: "Маленький",
        medium: "Средний",
        done: "Готово",
        dataSources: "Источники данных",
        weatherSource: "Погода",
        geolocationSource: "Геолокация",
        openSearch: "Открыть поиск",
        find: "Найти",
        searchPlaceholder: "Поиск в интернете...",
        empty: "Закладок пока нет.",
        addBookmarkHeading: "Добавить закладку",
        bookmarkTitle: "Название",
        bookmarkUrl: "Адрес сайта",
        cancel: "Отмена",
        create: "Создать",
        searchError: "Не удалось выполнить поиск.",
        bookmarkError: "Не удалось получить закладки Chrome.",
        saveError: "Не удалось сохранить настройки.",
        addError: "Не удалось добавить закладку.",
        invalidUrl: "Проверь адрес сайта."
    },
    en: {
        addItem: "Add bookmark or folder",
        chooseWhat: "What would you like to add?",
        addFolderHeading: "New folder",
        bookmarkType: "Bookmark",
        folderType: "Folder",
        parentFolder: "Folder in Chrome",
        deleteFolder: "Delete folder",
        deleteAction: "Delete",
        confirmDeleteFolder: "Delete folder \"{title}\" and all its bookmarks from Chrome?",
        settings: "Settings",
        openCalendar: "Open Google Calendar",
        deleteBookmark: "Delete bookmark",
        editBookmark: "Edit",
        editBookmarkHeading: "Edit bookmark",
        editFolderHeading: "Edit folder",
        folderColor: "Folder color",
        folderColorAmber: "Apricot",
        folderColorMint: "Sky blue",
        folderColorViolet: "Lavender",
        showBookmarkTitle: "Show name on the tile",
        save: "Save",
        editError: "Could not update the bookmark in Chrome.",
        deleteError: "Could not delete the bookmark from Chrome.",
        back: "Back",
        close: "Close",
        language: "Interface language",
        display: "Display",
        showSearch: "Show search",
        showBookmarks: "Show bookmarks",
        showBookmarkTitles: "Show bookmark names",
        tileSize: "Tile size",
        small: "Small",
        medium: "Medium",
        done: "Done",
        dataSources: "Data sources",
        weatherSource: "Weather",
        geolocationSource: "Geolocation",
        openSearch: "Open search",
        find: "Search",
        searchPlaceholder: "Search the web...",
        empty: "No bookmarks yet.",
        addBookmarkHeading: "Add bookmark",
        bookmarkTitle: "Name",
        bookmarkUrl: "Website",
        cancel: "Cancel",
        create: "Create",
        searchError: "Search failed.",
        bookmarkError: "Could not read Chrome bookmarks.",
        saveError: "Could not save settings.",
        addError: "Could not add bookmark.",
        invalidUrl: "Check the website address."
    }
};

function translate(key) {
    return translations[settings.language]?.[key] || key;
}

// меняем язык
function applyLanguage() {
    document.documentElement.lang = settings.language;
    document.querySelectorAll("[data-i18n]").forEach(function(element) {
        const key = element.dataset.i18n;
        element.textContent = translate(key);
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach(function(element) {
        element.setAttribute("aria-label", translate(element.dataset.i18nAriaLabel));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function(element) {
        const key = element.dataset.i18nPlaceholder;
        element.placeholder = translate(key);
    });
    refreshCustomSelects();
    updateClock();
    updateBookmarkCount();
}
