/**
 * PingLater - In-Chat Quick Snippets Content Script (Feature 3)
 * Injects into web.whatsapp.com to provide lightning-fast slash commands
 * (e.g. /cal, /pricing, /pay, /catchup) directly in the WhatsApp Web message box.
 */

(function () {
  'use strict';

  let templates = [];
  let popupElement = null;
  let activeMatches = [];
  let selectedIndex = 0;
  let currentActiveQuery = '';
  let activeComposer = null;

  // Initialize templates from storage
  function loadTemplates() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['pinglater_templates'], (res) => {
        templates = res.pinglater_templates || [];
      });
    }
  }

  // Listen for storage changes in real time (e.g. user adds/edits templates in dashboard)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.pinglater_templates) {
        templates = changes.pinglater_templates.newValue || [];
      }
    });
  }

  loadTemplates();

  // Create or retrieve floating popup DOM
  function getOrCreatePopup() {
    if (popupElement && document.body.contains(popupElement)) {
      return popupElement;
    }

    const popup = document.createElement('div');
    popup.id = 'pinglater-slash-popup';
    popup.style.display = 'none';

    popup.innerHTML = `
      <div class="pinglater-popup-header">
        <span class="pinglater-header-title">⚡ PingLater Snippets</span>
        <span id="pinglater-match-count" class="pinglater-header-badge">0</span>
      </div>
      <ul id="pinglater-list" class="pinglater-popup-list"></ul>
      <div class="pinglater-popup-footer">
        <span><span class="pinglater-kbd">↑</span><span class="pinglater-kbd">↓</span> Navigate</span>
        <span><span class="pinglater-kbd">↵ Enter</span> / <span class="pinglater-kbd">Tab</span> Insert</span>
        <span><span class="pinglater-kbd">Esc</span> Close</span>
      </div>
    `;

    document.body.appendChild(popup);
    popupElement = popup;
    return popup;
  }

  function hidePopup() {
    if (popupElement) {
      popupElement.style.display = 'none';
    }
    activeMatches = [];
    selectedIndex = 0;
    currentActiveQuery = '';
    activeComposer = null;
  }

  function isComposer(el) {
    if (!el) return false;
    return (
      (el.isContentEditable && (el.getAttribute('role') === 'textbox' || el.closest('footer') || el.dataset.tab === '10')) ||
      (el.tagName === 'DIV' && el.isContentEditable)
    );
  }

  // Extracts current contact's name from WhatsApp chat header
  function getActiveChatContactName() {
    try {
      const headerTitle =
        document.querySelector('header span[data-testid="conversation-info-header-chat-title"]') ||
        document.querySelector('#main header div[role="button"] span[title]') ||
        document.querySelector('#main header span[dir="auto"]');

      if (headerTitle) {
        const full = (headerTitle.getAttribute('title') || headerTitle.innerText || '').trim();
        // If it looks like a phone number (+91...), return empty to use fallback
        if (/^[\d\s+\-()]+$/.test(full)) return '';
        // Return first name
        return full.split(/\s+/)[0];
      }
    } catch (e) {
      // Ignore DOM reading error
    }
    return '';
  }

  // Render matching templates into floating popup
  function renderMatches(matches, query, composer) {
    const popup = getOrCreatePopup();
    const list = popup.querySelector('#pinglater-list');
    const badge = popup.querySelector('#pinglater-match-count');

    list.innerHTML = '';
    badge.textContent = `${matches.length} found`;

    matches.forEach((tpl, idx) => {
      const li = document.createElement('li');
      li.className = `pinglater-popup-item ${idx === selectedIndex ? 'selected' : ''}`;

      const shortcutLabel = tpl.shortcut ? `/${tpl.shortcut}` : `/${tpl.title.slice(0, 8).toLowerCase()}`;
      const previewText = (tpl.body || '').replace(/[\r\n]+/g, ' ');

      li.innerHTML = `
        <div class="pinglater-item-top">
          <span class="pinglater-item-shortcut">${escapeHtml(shortcutLabel)}</span>
          <span class="pinglater-item-title">${escapeHtml(tpl.title)}</span>
        </div>
        <div class="pinglater-item-preview">${escapeHtml(previewText)}</div>
      `;

      // Click to insert
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        insertSnippet(tpl, query.length + 1, composer);
      });

      list.appendChild(li);
    });

    // Position popup right above composer footer
    const rect = composer.getBoundingClientRect();
    const bottomPos = Math.max(10, window.innerHeight - rect.top + 8);
    const leftPos = Math.max(16, Math.min(rect.left, window.innerWidth - 380));

    popup.style.bottom = `${bottomPos}px`;
    popup.style.left = `${leftPos}px`;
    popup.style.display = 'flex';
  }

  function updateSelectionVisual() {
    if (!popupElement) return;
    const items = popupElement.querySelectorAll('.pinglater-popup-item');
    items.forEach((item, idx) => {
      if (idx === selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }

  // Insert snippet into WhatsApp Web's contenteditable message composer
  function insertSnippet(tpl, charactersToDelete, composer) {
    if (!composer) return;
    composer.focus();

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      try {
        // Delete the "/shortcut" text that the user typed
        for (let i = 0; i < charactersToDelete; i++) {
          sel.modify('extend', 'backward', 'character');
        }
      } catch (err) {
        console.warn('[PingLater] Selection modify fallback:', err);
      }
    }

    // Replace {{name}} placeholder with current contact's name if detected
    let body = tpl.body || '';
    const contactName = getActiveChatContactName();
    if (contactName) {
      body = body.replace(/\{\{\s*name\s*\}\}/gi, contactName);
    } else {
      body = body.replace(/\{\{\s*name\s*\}\}/gi, 'there');
    }

    // Insert text via document.execCommand
    // This triggers WhatsApp Web's Draft.js & React synthetic input events natively!
    document.execCommand('insertText', false, body);

    hidePopup();
  }

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ==========================================
  // EVENT LISTENERS: KEYDOWN & INPUT
  // ==========================================

  // Keydown intercepts Arrow navigation, Enter, Tab, and Escape
  document.addEventListener(
    'keydown',
    (e) => {
      if (!popupElement || popupElement.style.display === 'none' || activeMatches.length === 0) {
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        selectedIndex = (selectedIndex + 1) % activeMatches.length;
        updateSelectionVisual();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        selectedIndex = (selectedIndex - 1 + activeMatches.length) % activeMatches.length;
        updateSelectionVisual();
        return;
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        const selectedTpl = activeMatches[selectedIndex];
        if (selectedTpl && activeComposer) {
          insertSnippet(selectedTpl, currentActiveQuery.length + 1, activeComposer);
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        hidePopup();
      }
    },
    true // Capture phase to prevent WhatsApp from sending message on Enter
  );

  // Keyup and input to detect `/` commands as user types
  function handleInputOrKeyup(e) {
    const target = e.target;
    if (!isComposer(target)) {
      return;
    }

    activeComposer = target;

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      hidePopup();
      return;
    }

    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      hidePopup();
      return;
    }

    const textBeforeCaret = node.textContent.slice(0, range.startOffset);
    const lastSlashIdx = textBeforeCaret.lastIndexOf('/');

    if (lastSlashIdx === -1) {
      hidePopup();
      return;
    }

    // Must be either at start of line or preceded by whitespace
    if (lastSlashIdx > 0 && !/\s/.test(textBeforeCaret[lastSlashIdx - 1])) {
      hidePopup();
      return;
    }

    const query = textBeforeCaret.slice(lastSlashIdx + 1);

    // If there is any space after the slash, user is typing normal text -> hide
    if (/\s/.test(query)) {
      hidePopup();
      return;
    }

    currentActiveQuery = query;

    // Filter templates matching query by shortcut or title
    const q = query.toLowerCase();
    activeMatches = templates.filter((t) => {
      const sc = (t.shortcut || '').toLowerCase();
      const title = (t.title || '').toLowerCase();
      return sc.startsWith(q) || title.includes(q);
    });

    if (activeMatches.length > 0) {
      selectedIndex = 0;
      renderMatches(activeMatches, query, target);
    } else {
      hidePopup();
    }
  }

  document.addEventListener('keyup', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
      return;
    }
    handleInputOrKeyup(e);
  });

  document.addEventListener('input', (e) => {
    handleInputOrKeyup(e);
  });

  // Clicking outside closes the popup
  document.addEventListener('click', (e) => {
    if (popupElement && !popupElement.contains(e.target)) {
      hidePopup();
    }
  });

  console.log('[PingLater] In-Chat Quick Snippets loaded on WhatsApp Web.');
})();
