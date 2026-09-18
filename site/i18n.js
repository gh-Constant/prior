/* Prior static-site i18n engine (no dependency, file:// and http compatible).
 * Requires `window.PRIOR_I18N` (loaded via i18n-dicts.js before this file).
 * Independent from downloads.js: it only touches `data-i18n*` attributes and
 * never rewrites [data-platform], [data-release-tag] or [data-release-link]. */
(function () {
  "use strict";

  var SUPPORTED = ["en", "fr", "es", "de", "pt"];
  var STORE_KEY = "prior.site.lang";
  var SELECT_ID = "site-lang";

  function baseLang(tag) {
    return String(tag || "").toLowerCase().split(/[-_]/)[0];
  }

  function normalize(code) {
    var base = baseLang(code);
    return SUPPORTED.indexOf(base) !== -1 ? base : "en";
  }

  function readStored() {
    try {
      var saved = window.localStorage.getItem(STORE_KEY);
      if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    } catch (err) {
      /* Storage unavailable (private mode, file://, disabled): fall through. */
    }
    return null;
  }

  function detect() {
    var stored = readStored();
    if (stored) return stored;
    var nav = null;
    try {
      nav = (Array.isArray(navigator.languages) && navigator.languages[0]) ||
        navigator.language ||
        navigator.userLanguage ||
        "en";
    } catch (err) {
      nav = "en";
    }
    return normalize(nav);
  }

  function lookup(lang, key) {
    var dicts = window.PRIOR_I18N || {};
    var langDict = dicts[lang] || {};
    if (langDict[key] != null) return langDict[key];
    var enDict = dicts.en || {};
    if (enDict[key] != null) return enDict[key];
    return null;
  }

  function varsOf(element) {
    var raw = element.getAttribute("data-i18n-vars");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  /* Optional `{name}` interpolation (identical tokens across languages). */
  function fill(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, function (match, name) {
      return vars && vars[name] != null ? String(vars[name]) : match;
    });
  }

  function translate(lang, key, vars) {
    var template = lookup(lang, key);
    return template == null ? null : fill(template, vars);
  }

  function apply(lang) {
    lang = normalize(lang);

    var textNodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < textNodes.length; i++) {
      var value = translate(lang, textNodes[i].getAttribute("data-i18n"), varsOf(textNodes[i]));
      if (value != null) textNodes[i].textContent = value;
    }

    var htmlNodes = document.querySelectorAll("[data-i18n-html]");
    for (var h = 0; h < htmlNodes.length; h++) {
      var html = translate(lang, htmlNodes[h].getAttribute("data-i18n-html"), varsOf(htmlNodes[h]));
      /* Trusted content only: strings come from our own checked-in dictionaries. */
      if (html != null) htmlNodes[h].innerHTML = html;
    }

    var phNodes = document.querySelectorAll("[data-i18n-ph]");
    for (var p = 0; p < phNodes.length; p++) {
      var ph = translate(lang, phNodes[p].getAttribute("data-i18n-ph"), varsOf(phNodes[p]));
      if (ph != null) phNodes[p].setAttribute("placeholder", ph);
    }

    var ariaNodes = document.querySelectorAll("[data-i18n-aria]");
    for (var a = 0; a < ariaNodes.length; a++) {
      var label = translate(lang, ariaNodes[a].getAttribute("data-i18n-aria"), varsOf(ariaNodes[a]));
      if (label != null) ariaNodes[a].setAttribute("aria-label", label);
    }

    var titleNodes = document.querySelectorAll("[data-i18n-title]");
    for (var t = 0; t < titleNodes.length; t++) {
      var title = translate(lang, titleNodes[t].getAttribute("data-i18n-title"), varsOf(titleNodes[t]));
      if (title != null) titleNodes[t].setAttribute("title", title);
    }

    var metaNodes = document.querySelectorAll('meta[name="description"][data-i18n-content]');
    for (var m = 0; m < metaNodes.length; m++) {
      var content = translate(lang, metaNodes[m].getAttribute("data-i18n-content"), varsOf(metaNodes[m]));
      if (content != null) metaNodes[m].setAttribute("content", content);
    }

    document.documentElement.lang = lang;

    var select = document.getElementById(SELECT_ID);
    if (select && select.value !== lang) select.value = lang;

    try {
      window.localStorage.setItem(STORE_KEY, lang);
    } catch (err) {
      /* Storage unavailable: language still applies for this page view. */
    }
  }

  window.setSiteLang = function (code) {
    apply(normalize(code));
  };

  function init() {
    apply(detect());
    var select = document.getElementById(SELECT_ID);
    if (select) {
      select.addEventListener("change", function () {
        window.setSiteLang(select.value);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
