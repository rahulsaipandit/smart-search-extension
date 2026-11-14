/**
 * First-install welcome page (welcome.html), shared by every extension.
 *
 * Nothing here names a product: the extension name and logo come from the manifest
 * (`chrome.i18n` `extName`, falling back to `manifest.name`; the largest `manifest.icons`
 * entry), so the same two files work unchanged in each extension.
 *
 * The background script opens this tab once, on a fresh install. Chrome does not let an
 * extension pin itself, so the page teaches the user to pin it and then shows where the
 * icon is:
 *
 *   - Pin state is read live from chrome.action.getUserSettings().isOnToolbar
 *     (Chrome 91+). It is re-read on chrome.action.onUserSettingsChanged
 *     (Chrome 130+) and on a 1 s poll for older Chrome, so the page flips to
 *     "Pinned" the moment the user pins it.
 *   - The Open button opens the side panel with chrome.sidePanel.open() when the
 *     extension has one, otherwise the popup with chrome.action.openPopup(). Both need
 *     the click as a user gesture, which is why the button calls them directly.
 *   - Keyboard shortcuts are listed from chrome.commands.getAll(), so the page shows the
 *     real binding of each command the extension declares. Chrome leaves a command
 *     unassigned when another extension already uses the keys.
 */
(function () {
  'use strict';

  // ── pure helpers (no DOM, no chrome.*) ─────────────────────────────────────
  // Pin state from getUserSettings(): true / false, or null when unknown.
  function pinStateFrom(settings) {
    if (!settings || typeof settings.isOnToolbar !== 'boolean') return null;
    return settings.isOnToolbar;
  }
  // Shortcut rows from chrome.commands.getAll(): the commands the user can press, each with its
  // binding or '' when unset. Commands without a description are not shown (nothing to label them with).
  function shortcutsFrom(commands) {
    var list = Array.isArray(commands) ? commands : [];
    var rows = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || !c.description) continue;
      rows.push({ description: c.description, shortcut: c.shortcut || '' });
    }
    return rows;
  }
  // Path of the largest icon in manifest.icons ({ "64": "a.png", "128": "b.png" }), or '' when none.
  function largestIconFrom(icons) {
    var best = '';
    var bestSize = -1;
    var keys = icons ? Object.keys(icons) : [];
    for (var i = 0; i < keys.length; i++) {
      var size = parseInt(keys[i], 10);
      if (size > bestSize) { bestSize = size; best = icons[keys[i]]; }
    }
    return best;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { pinStateFrom: pinStateFrom, shortcutsFrom: shortcutsFrom, largestIconFrom: largestIconFrom };
  }
  if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.action) return;

  function $(id) { return document.getElementById(id); }
  function show(id, on) { var e = $(id); if (e) e.classList.toggle('hidden', !on); }

  // ── identity from the manifest ─────────────────────────────────────────────
  var manifest = chrome.runtime.getManifest();
  var extName = (chrome.i18n && chrome.i18n.getMessage('extName')) || manifest.name || 'This extension';
  document.title = 'Welcome to ' + extName;
  Array.prototype.forEach.call(document.querySelectorAll('[data-ext-name]'), function (el) {
    el.textContent = extName;
  });
  var iconPath = largestIconFrom(manifest.icons);
  if (iconPath) {
    var iconUrl = chrome.runtime.getURL(iconPath);
    var logo = $('extLogo'); if (logo) { logo.src = iconUrl; logo.classList.remove('hidden'); }
    var glyph = $('toolbarIcon'); if (glyph) glyph.src = iconUrl;
    var link = document.createElement('link');
    link.rel = 'icon'; link.href = iconUrl;
    document.head.appendChild(link);
  }

  // ── pin state ──────────────────────────────────────────────────────────────
  var lastPinned;
  function renderPin(pinned) {
    if (pinned === lastPinned) return;
    lastPinned = pinned;
    show('pinStatus', pinned === false);
    show('pinDone', pinned === true);
    show('pinUnknown', pinned === null);
    var card = $('stepPin'); if (card) card.classList.toggle('done', pinned === true);
    var num = $('pinNum'); if (num) num.textContent = pinned === true ? '✓' : '1';
    var ptr = $('pointer'); if (ptr) ptr.classList.toggle('pinned', pinned === true);
    var label = $('pointerLabel');
    if (label) {
      label.textContent = pinned === true
        ? 'Pinned up here. Click its icon to open it.'
        : 'Click the Extensions button (puzzle piece) up here, then pin ' + extName;
    }
  }

  function readPin() {
    try {
      if (!chrome.action.getUserSettings) { renderPin(null); return; }
      chrome.action.getUserSettings(function (s) {
        if (chrome.runtime.lastError) { renderPin(null); return; }
        renderPin(pinStateFrom(s));
      });
    } catch (e) { renderPin(null); }
  }

  // ── shortcuts ──────────────────────────────────────────────────────────────
  function renderShortcuts(rows) {
    var ul = $('shortcutList');
    if (!ul) return;
    ul.textContent = '';
    rows.forEach(function (row) {
      var li = document.createElement('li');
      var label = document.createElement('span');
      label.textContent = row.description;
      li.appendChild(label);
      if (row.shortcut) {
        var kbd = document.createElement('kbd');
        kbd.textContent = row.shortcut;
        li.appendChild(kbd);
      } else {
        var unset = document.createElement('span');
        unset.className = 'unset';
        unset.textContent = 'not set';
        li.appendChild(unset);
      }
      ul.appendChild(li);
    });
    show('shortcutsBlock', rows.length > 0);
  }

  function readShortcuts() {
    try {
      chrome.commands.getAll(function (cmds) {
        if (chrome.runtime.lastError) { renderShortcuts([]); return; }
        renderShortcuts(shortcutsFrom(cmds));
      });
    } catch (e) { renderShortcuts([]); }
  }

  readPin();
  readShortcuts();
  try {
    if (chrome.action.onUserSettingsChanged) {
      chrome.action.onUserSettingsChanged.addListener(function (s) { renderPin(pinStateFrom(s)); });
    }
  } catch (e) {}
  setInterval(readPin, 1000);
  // Shortcuts may be (re)assigned in chrome://extensions/shortcuts in another tab.
  document.addEventListener('visibilitychange', function () { if (!document.hidden) readShortcuts(); });

  // ── buttons ────────────────────────────────────────────────────────────────
  function openFailed(err) {
    console.warn('[welcome] could not open the extension from this page:', err);
    show('openFallback', true);
  }

  // sidePanel.open() must run synchronously inside the click, so the window id is looked up once
  // at load instead of awaiting tabs.getCurrent() in the handler.
  var pageWindowId;
  try {
    chrome.tabs.getCurrent(function (tab) { if (!chrome.runtime.lastError && tab) pageWindowId = tab.windowId; });
  } catch (e) {}

  var openBtn = $('btnOpen');
  if (openBtn) openBtn.addEventListener('click', function () {
    show('openFallback', false);
    try {
      if (chrome.sidePanel && chrome.sidePanel.open) {
        if (pageWindowId === undefined) { openFailed(new Error('window id not known yet')); return; }
        chrome.sidePanel.open({ windowId: pageWindowId }).catch(openFailed);
        return;
      }
      var p = chrome.action.openPopup();
      if (p && typeof p.catch === 'function') p.catch(openFailed);
    } catch (e) { openFailed(e); }
  });

  // Same key and shape as WELCOME_KEY / WelcomeRecord in the extension's welcomeState module; the page is
  // plain JS and cannot import it. The record is merged so the `shownAt` the background wrote is kept.
  var dismissBtn = $('btnDismiss');
  if (dismissBtn) dismissBtn.addEventListener('click', function () {
    try {
      chrome.storage.local.get('welcomeState', function (stored) {
        var record = Object.assign({}, stored && stored.welcomeState, { dismissed: true });
        chrome.storage.local.set({ welcomeState: record }, function () {
          if (chrome.runtime.lastError) { console.warn('[welcome] could not save the choice:', chrome.runtime.lastError); return; }
          window.close();
        });
      });
    } catch (e) { console.warn('[welcome] could not save the choice:', e); }
  });

  var scBtn = $('btnShortcuts');
  if (scBtn) scBtn.addEventListener('click', function () {
    try { chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); } catch (e) { console.warn('[welcome] could not open the shortcuts page:', e); }
  });
})();
