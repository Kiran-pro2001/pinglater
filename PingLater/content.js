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

    // Prevent clicking anywhere inside popup from stealing focus from message composer
    popup.onmousedown = (e) => e.preventDefault();

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

  // Insert snippet into WhatsApp Web's Lexical/contenteditable composer
  function insertSnippet(tpl, charactersToDelete, composer) {
    if (!composer) return;
    composer.focus();

    // Replace {{name}} placeholder with current contact's name if detected
    let body = tpl.body || '';
    const contactName = getActiveChatContactName();
    if (contactName) {
      body = body.replace(/\{\{\s*name\s*\}\}/gi, contactName);
    } else {
      body = body.replace(/\{\{\s*name\s*\}\}/gi, 'there');
    }

    const querySlash = currentActiveQuery ? `/${currentActiveQuery.toLowerCase()}` : '';
    const shortcutSlash = tpl.shortcut ? `/${tpl.shortcut.toLowerCase()}` : '';

    // Step 1: Detect if composer ONLY contains the slash command (/gf, /call, etc.)
    const trimmed = (composer.textContent || '').trim().replace(/[\u200B\u200C\u200D\uFEFF]/g, '').toLowerCase();
    const isOnlySlash =
      (querySlash && trimmed === querySlash) ||
      (shortcutSlash && trimmed === shortcutSlash) ||
      (trimmed.startsWith('/') && !trimmed.includes(' '));

    if (isOnlySlash) {
      // Clean-slate replacement: select all text in composer so paste/insertText completely overwrites /gf
      try {
        document.execCommand('selectAll');
        document.execCommand('delete');
      } catch (e) {}
    } else {
      // Surgical replacement: locate the specific text node containing the slash query
      const walker = document.createTreeWalker(composer, NodeFilter.SHOW_TEXT);
      let currNode;
      let targetNode = null;
      let targetIdx = -1;
      let matchLen = 0;

      while ((currNode = walker.nextNode())) {
        const lower = currNode.textContent.toLowerCase();
        if (querySlash && lower.includes(querySlash)) {
          targetNode = currNode;
          targetIdx = lower.lastIndexOf(querySlash);
          matchLen = querySlash.length;
          break;
        }
        if (shortcutSlash && lower.includes(shortcutSlash)) {
          targetNode = currNode;
          targetIdx = lower.lastIndexOf(shortcutSlash);
          matchLen = shortcutSlash.length;
          break;
        }
        const slashPos = lower.lastIndexOf('/');
        if (slashPos !== -1) {
          targetNode = currNode;
          targetIdx = slashPos;
          matchLen = lower.length - slashPos;
          break;
        }
      }

      if (targetNode && targetIdx !== -1) {
        // Highlight specifically the /query so any delete or insert replaces it
        try {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.setStart(targetNode, targetIdx);
            range.setEnd(targetNode, targetIdx + matchLen);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('delete');
          }
        } catch (e) {}

        // Direct slice backup if execCommand did not alter node
        if (targetNode.textContent.toLowerCase().includes(querySlash || '/')) {
          const cutIdx = targetNode.textContent.toLowerCase().lastIndexOf(querySlash || '/');
          if (cutIdx !== -1) {
            const cutLen = querySlash ? querySlash.length : targetNode.textContent.length - cutIdx;
            targetNode.textContent = targetNode.textContent.slice(0, cutIdx) + targetNode.textContent.slice(cutIdx + cutLen);
            try {
              const sel = window.getSelection();
              if (sel) {
                const r = document.createRange();
                r.setStart(targetNode, cutIdx);
                r.setEnd(targetNode, cutIdx);
                sel.removeAllRanges();
                sel.addRange(r);
              }
            } catch (e) {}
          }
        }
      } else {
        // Fallback selection removal
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          try {
            for (let i = 0; i < charactersToDelete; i++) {
              sel.modify('extend', 'backward', 'character');
            }
            const range = sel.getRangeAt(0);
            range.deleteContents();
          } catch (e) {}
        }
      }
    }

    // Step 2: Native Synthetic Paste Event (Lexical + React Native handler)
    let handledByPaste = false;
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', body);
      const pasteEvt = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });
      const allowed = composer.dispatchEvent(pasteEvt);
      if (!allowed) {
        handledByPaste = true;
      }
    } catch (e) {
      console.warn('[PingLater] Paste event failed:', e);
    }

    // Step 3: Fallback insertText if paste was not handled
    if (!handledByPaste) {
      try {
        document.execCommand('insertText', false, body);
      } catch (e) {}
    }

    // Step 4: Dispatch InputEvent to turn mic button into send button
    try {
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: body }));
    } catch (e) {}

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
    const dropdown = document.getElementById('pinglater-dropdown-snooze');
    const trigger = document.getElementById('pinglater-btn-trigger-snooze');
    if (dropdown && trigger && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  // ==========================================
  // "AWAITING REPLY" SMART SNOOZE (FEATURE 2)
  // ==========================================
  let snoozes = [];
  let snoozeContainer = null;
  let activeChatObserver = null;

  function loadSnoozes() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['pinglater_snoozed_chats'], (res) => {
        snoozes = res.pinglater_snoozed_chats || [];
        updateSnoozePill();
        updateLeftChatListBadges();
      });
    }
  }

  // Real-time storage listener for snoozes
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.pinglater_snoozed_chats) {
        snoozes = changes.pinglater_snoozed_chats.newValue || [];
        updateSnoozePill();
        updateLeftChatListBadges();
      }
    });
  }

  loadSnoozes();

  function getCurrentChatInfo() {
    try {
      const mainChat = document.querySelector('#main');
      if (!mainChat) return null;

      let rawTitle = '';

      // Check header inside #main
      const header = mainChat.querySelector('header') || mainChat.querySelector('[data-testid="conversation-header"]') || mainChat.firstElementChild;
      if (header) {
        // Try elements with title attributes first
        const titleWithAttr = header.querySelector('[title]:not([role="button"]):not(button)');
        if (titleWithAttr && titleWithAttr.getAttribute('title')) {
          rawTitle = titleWithAttr.getAttribute('title').trim();
        }

        if (!rawTitle) {
          const candidate =
            header.querySelector('span[data-testid="conversation-info-header-chat-title"]') ||
            header.querySelector('div[role="button"] span[title]') ||
            header.querySelector('div[role="button"] span[dir="auto"]') ||
            header.querySelector('h2') ||
            header.querySelector('span[dir="auto"]');
          if (candidate) {
            rawTitle = (candidate.getAttribute('title') || candidate.textContent || '').trim();
          }
        }
      }

      // Check active item in left conversation list
      if (!rawTitle) {
        const activeLeftItem =
          document.querySelector('#pane-side div[aria-selected="true"]') ||
          document.querySelector('#pane-side div[tabindex="0"]');
        if (activeLeftItem) {
          const nameSpan = activeLeftItem.querySelector('span[title]') || activeLeftItem.querySelector('span[dir="auto"]');
          if (nameSpan) {
            rawTitle = (nameSpan.getAttribute('title') || nameSpan.textContent || '').trim();
          }
        }
      }

      // Fallback: never let rawTitle be empty when active chat is open
      if (!rawTitle) {
        rawTitle = 'Contact';
      }

      const phoneDigits = rawTitle.replace(/\D/g, '');
      const isPhoneTitle = phoneDigits.length >= 7 && /^[\d\s+\-()]+$/.test(rawTitle);

      return {
        title: rawTitle,
        contactName: isPhoneTitle ? '' : rawTitle.split(/\s+/)[0],
        phone: isPhoneTitle ? phoneDigits : '',
        cleanIdentifier: isPhoneTitle ? phoneDigits : rawTitle.toLowerCase()
      };
    } catch (e) {
      return {
        title: 'Contact',
        contactName: 'Contact',
        phone: '',
        cleanIdentifier: 'active_chat'
      };
    }
  }

  function getActiveSnoozeForCurrentChat() {
    const info = getCurrentChatInfo();
    if (!info) return null;

    return (
      snoozes.find((s) => {
        if (s.status !== 'awaiting') return false;
        if (info.phone && s.phone && String(s.phone).replace(/\D/g, '') === info.phone) return true;
        if (info.title && s.contactName && s.contactName.trim().toLowerCase() === info.title.trim().toLowerCase()) return true;
        return false;
      }) || null
    );
  }

  function formatRemainingTime(dueAtIso) {
    const diffMs = new Date(dueAtIso).getTime() - Date.now();
    if (diffMs <= 0) return 'Overdue';
    const totalSecs = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remH = hours % 24;
      return `${days}d ${remH}h ${mins}m ${secs}s`;
    }
    if (hours > 0) {
      return `${hours}h ${mins}m ${secs}s`;
    }
    return `${mins}m ${secs}s`;
  }

  function calculateSnoozeProgress(snooze) {
    if (!snooze || !snooze.dueAt) return 0;
    const startTime = new Date(snooze.snoozedAt || snooze.createdAt).getTime();
    const dueTime = new Date(snooze.dueAt).getTime();
    const totalMs = Math.max(1000, dueTime - startTime);
    const elapsedMs = Math.max(0, Date.now() - startTime);
    return Math.min(100, Math.max(0, Math.round((elapsedMs / totalMs) * 100)));
  }

  function getOrCreateSnoozeContainer() {
    if (snoozeContainer && document.body.contains(snoozeContainer)) {
      return snoozeContainer;
    }
    const container = document.createElement('div');
    container.id = 'pinglater-snooze-container';
    document.body.appendChild(container);
    snoozeContainer = container;
    return container;
  }

  function updateSnoozePill() {
    const mainChat = document.querySelector('#main');
    if (!mainChat) {
      if (snoozeContainer) snoozeContainer.style.display = 'none';
      return;
    }

    const info = getCurrentChatInfo();
    const container = getOrCreateSnoozeContainer();
    container.style.display = 'block';

    // Calculate dynamic position inside the active chat's header bar
    const header = mainChat.querySelector('header') || mainChat.firstElementChild;
    if (header) {
      const headerRect = header.getBoundingClientRect();
      container.style.position = 'fixed';
      container.style.top = `${Math.max(8, headerRect.top + 10)}px`;
      container.style.right = `${Math.max(16, window.innerWidth - headerRect.right + 120)}px`;
      container.style.zIndex = '2147483647';
    } else {
      const mainRect = mainChat.getBoundingClientRect();
      container.style.position = 'fixed';
      container.style.top = `${Math.max(8, mainRect.top + 10)}px`;
      container.style.right = `${Math.max(16, window.innerWidth - mainRect.right + 24)}px`;
      container.style.zIndex = '2147483647';
    }

    const activeSnooze = getActiveSnoozeForCurrentChat();
    const activeContactId = info ? (info.phone || info.title) : 'none';
    const desiredState = activeSnooze ? `awaiting_${activeSnooze.id}` : `idle_${activeContactId}`;

    // Auto-reply check in active chat: if the other person already replied, resolve snooze immediately!
    if (activeSnooze && activeSnooze.status === 'awaiting') {
      const resolved = checkActiveChatForReply(activeSnooze);
      if (resolved) {
        return;
      }
    }

    // If dropdown is currently open, do not overwrite DOM
    const existingDropdown = container.querySelector('#pinglater-dropdown-snooze');
    if (existingDropdown && existingDropdown.style.display === 'flex') {
      return;
    }

    // If state hasn't changed, only update live countdown text without destroying DOM
    if (container.dataset.currentState === desiredState) {
      if (activeSnooze) {
        const badge = container.querySelector('.pinglater-snooze-badge');
        if (badge) {
          badge.textContent = formatRemainingTime(activeSnooze.dueAt);
        }
      }
      return;
    }

    container.dataset.currentState = desiredState;

    if (activeSnooze) {
      const remaining = formatRemainingTime(activeSnooze.dueAt);
      container.innerHTML = `
        <div class="pinglater-snooze-pill awaiting">
          <span>⏳</span>
          <span>Awaiting reply</span>
          <span class="pinglater-snooze-badge">${escapeHtml(remaining)}</span>
          <button type="button" class="pinglater-pill-btn-action btn-replied" title="Mark as replied">✓ Replied</button>
          <button type="button" class="pinglater-pill-btn-action btn-cancel" title="Cancel snooze">✕</button>
        </div>
      `;

      container.querySelector('.btn-replied')?.addEventListener('click', (e) => {
        e.stopPropagation();
        container.dataset.currentState = '';
        resolveSnoozeManual(activeSnooze.id);
      });

      container.querySelector('.btn-cancel')?.addEventListener('click', (e) => {
        e.stopPropagation();
        container.dataset.currentState = '';
        cancelSnooze(activeSnooze.id);
      });
    } else {
      container.innerHTML = `
        <div class="pinglater-snooze-pill">
          <button type="button" class="pinglater-snooze-btn-trigger" id="pinglater-btn-trigger-snooze">
            <span>💤</span>
            <span>Snooze if no reply</span>
            <span style="font-size: 9px; opacity: 0.6;">▾</span>
          </button>
          <div class="pinglater-snooze-dropdown" id="pinglater-dropdown-snooze" style="display:none;">
            <div class="pinglater-snooze-dropdown-header">Remind me if no reply:</div>
            <div class="pinglater-snooze-dropdown-item" data-mins="60" data-label="1 hour">
              <span>⚡ In 1 hour</span>
              <span style="font-size:11px; opacity:0.6;">1h</span>
            </div>
            <div class="pinglater-snooze-dropdown-item" data-mins="150" data-label="2h 30m">
              <span>⏳ In 2 hours 30 mins</span>
              <span class="recommended">Popular</span>
            </div>
            <div class="pinglater-snooze-dropdown-item" data-mins="1440" data-label="24 hours">
              <span>🎯 In 24 hours</span>
              <span style="font-size:11px; opacity:0.6;">Tomorrow</span>
            </div>
            <div class="pinglater-snooze-dropdown-item" data-mins="2880" data-label="48 hours">
              <span>📅 In 48 hours</span>
              <span style="font-size:11px; opacity:0.6;">2 days</span>
            </div>
            <div class="pinglater-snooze-dropdown-item" data-mins="10080" data-label="1 week">
              <span>🗓️ In 1 week</span>
              <span style="font-size:11px; opacity:0.6;">7 days</span>
            </div>
            <div class="pinglater-snooze-custom-panel">
              <div class="pinglater-snooze-custom-title">⏱️ Or Custom Duration:</div>
              <div class="pinglater-snooze-custom-inputs">
                <div class="pinglater-custom-input-group">
                  <input type="number" id="pinglaterCustomHours" min="0" max="720" value="1" class="pinglater-custom-num">
                  <label>h</label>
                </div>
                <div class="pinglater-custom-input-group">
                  <input type="number" id="pinglaterCustomMins" min="0" max="59" step="5" value="30" class="pinglater-custom-num">
                  <label>m</label>
                </div>
                <button type="button" id="btnPinglaterApplyCustomSnooze" class="pinglater-btn-apply-custom">Set ⏱️</button>
              </div>
              <div class="pinglater-custom-chips">
                <button type="button" class="pinglater-chip" data-h="0" data-m="30">30m</button>
                <button type="button" class="pinglater-chip" data-h="1" data-m="0">1h</button>
                <button type="button" class="pinglater-chip" data-h="2" data-m="30">2h 30m</button>
                <button type="button" class="pinglater-chip" data-h="4" data-m="0">4h</button>
              </div>
            </div>
          </div>
        </div>
      `;

      const trigger = container.querySelector('#pinglater-btn-trigger-snooze');
      const dropdown = container.querySelector('#pinglater-dropdown-snooze');
      const customHoursInput = container.querySelector('#pinglaterCustomHours');
      const customMinsInput = container.querySelector('#pinglaterCustomMins');
      const applyCustomBtn = container.querySelector('#btnPinglaterApplyCustomSnooze');

      trigger?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
      });

      // Quick preset dropdown options
      container.querySelectorAll('.pinglater-snooze-dropdown-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const mins = parseInt(item.dataset.mins, 10) || 1440;
          const label = item.dataset.label || `${mins}m`;
          dropdown.style.display = 'none';
          container.dataset.currentState = '';
          createSnoozeByMinutes(mins, label);
        });
      });

      // Custom duration Set button
      applyCustomBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const h = parseInt(customHoursInput?.value, 10) || 0;
        const m = parseInt(customMinsInput?.value, 10) || 0;
        const totalMinutes = h * 60 + m;
        if (totalMinutes <= 0) {
          showPingLaterToast('⚠️', 'Please enter at least 1 minute duration.');
          return;
        }
        const label = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
        dropdown.style.display = 'none';
        container.dataset.currentState = '';
        createSnoozeByMinutes(totalMinutes, label);
      });

      // Quick Chips (30m, 1h, 2h 30m, 4h)
      container.querySelectorAll('.pinglater-chip').forEach((chip) => {
        chip.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const h = parseInt(chip.dataset.h, 10) || 0;
          const m = parseInt(chip.dataset.m, 10) || 0;
          if (customHoursInput) customHoursInput.value = h;
          if (customMinsInput) customMinsInput.value = m;
          const totalMinutes = h * 60 + m;
          const label = chip.textContent.trim();
          dropdown.style.display = 'none';
          container.dataset.currentState = '';
          createSnoozeByMinutes(totalMinutes, label);
        });
      });
    }
  }

  function createSnooze(hours) {
    createSnoozeByMinutes(Math.round(hours * 60), `${hours}h`);
  }

  function createSnoozeByMinutes(totalMinutes, label) {
    const info = getCurrentChatInfo();
    if (!info) return;

    const now = new Date();
    const dueAt = new Date(now.getTime() + totalMinutes * 60000).toISOString();
    const durationHours = totalMinutes / 60;
    const contactDisplayName = info.title || (info.phone ? `+${info.phone}` : 'Contact');

    const lastBubble = getLastMessageBubble();
    const lastSeenMessageId = getLastBubbleId(lastBubble);

    const newSnooze = {
      id: `snooze_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      contactName: contactDisplayName,
      phone: info.phone || '',
      cleanIdentifier: info.cleanIdentifier,
      lastSeenMessageId: lastSeenMessageId,
      snoozedAt: now.toISOString(),
      dueAt: dueAt,
      durationHours: durationHours,
      durationMinutes: totalMinutes,
      status: 'awaiting',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    // Reflect synchronously in memory to eliminate render latency
    snoozes.unshift(newSnooze);
    if (snoozeContainer) {
      snoozeContainer.dataset.currentState = '';
    }

    chrome.storage.local.get(['pinglater_snoozed_chats'], (res) => {
      const list = res.pinglater_snoozed_chats || [];
      list.unshift(newSnooze);
      chrome.storage.local.set({ pinglater_snoozed_chats: list }, () => {
        // Schedule background alarm
        chrome.runtime.sendMessage({
          type: 'SCHEDULE_SNOOZE_ALARM',
          snoozeId: newSnooze.id,
          dueAt: newSnooze.dueAt,
          contactName: newSnooze.contactName,
          phone: newSnooze.phone
        });

        const displayLabel = label || (totalMinutes >= 60 ? `${durationHours.toFixed(1).replace('.0', '')}h` : `${totalMinutes}m`);
        showPingLaterToast('💤', `Snoozed for ${displayLabel}! If ${contactDisplayName} replies, PingLater will auto-dismiss.`);
        updateSnoozePill();
        updateLeftChatListBadges();
      });
    });
  }

  function resolveSnoozeManual(id) {
    // 1. Immediately update in-memory snoozes array
    const memItem = snoozes.find((s) => s.id === id);
    if (memItem) {
      memItem.status = 'replied';
      memItem.repliedAt = new Date().toISOString();
    }

    // 2. Clear dataset state so pill re-renders immediately
    if (snoozeContainer) {
      snoozeContainer.dataset.currentState = '';
    }

    // 3. Persist to storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['pinglater_snoozed_chats'], (res) => {
        const list = res.pinglater_snoozed_chats || [];
        const item = list.find((s) => s.id === id);
        if (item) {
          item.status = 'replied';
          item.repliedAt = new Date().toISOString();
          chrome.storage.local.set({ pinglater_snoozed_chats: list }, () => {
            if (chrome.runtime?.id) {
              chrome.runtime.sendMessage({ type: 'CANCEL_SNOOZE_ALARM', snoozeId: id });
            }
          });
        }
      });
    }

    // 4. Update UI immediately
    showPingLaterToast('🎉', `Marked as replied! Follow-up reminder cleared.`);
    updateSnoozePill();
    updateLeftChatListBadges();

    // 5. Notify Cadence Engine (Feature 5: Stop-on-Reply)
    const targetContact = memItem || getCurrentChatInfo();
    if (targetContact && typeof chrome !== 'undefined' && chrome.runtime?.id) {
      chrome.runtime.sendMessage({
        type: 'CADENCE_CONTACT_REPLIED',
        phone: targetContact.phone || '',
        name: targetContact.contactName || targetContact.title || ''
      }).catch(() => {});
    }
  }

  function cancelSnooze(id) {
    snoozes = snoozes.filter((s) => s.id !== id);
    if (snoozeContainer) snoozeContainer.dataset.currentState = '';

    chrome.storage.local.get(['pinglater_snoozed_chats'], (res) => {
      const list = (res.pinglater_snoozed_chats || []).filter((s) => s.id !== id);
      chrome.storage.local.set({ pinglater_snoozed_chats: list }, () => {
        chrome.runtime.sendMessage({ type: 'CANCEL_SNOOZE_ALARM', snoozeId: id });
        showPingLaterToast('✕', `Snooze reminder cancelled.`);
        updateSnoozePill();
        updateLeftChatListBadges();
      });
    });
  }

  // ==========================================
  // AUTO-REPLY DETECTION HELPERS
  // ==========================================
  function getLastMessageBubble() {
    const mainChat = document.querySelector('#main');
    if (!mainChat) return null;

    const selectors = [
      'div[data-testid="msg-container"]',
      'div[data-id^="false_"]',
      'div[data-id^="true_"]',
      '.message-in',
      '.message-out',
      'div[class*="message-in"]',
      'div[class*="message-out"]'
    ];

    const bubbles = Array.from(mainChat.querySelectorAll(selectors.join(', '))).filter((b) => {
      if (b.closest('footer, [data-testid="conversation-compose-box"]')) return false;
      return true;
    });

    if (bubbles.length > 0) {
      return bubbles[bubbles.length - 1];
    }

    // Fallback: search role="row" inside main chat
    const rows = Array.from(mainChat.querySelectorAll('div[role="row"]')).filter((r) => {
      return r.querySelector('[data-pre-plain-text], span[data-icon*="check"], .copyable-text');
    });
    return rows.length > 0 ? rows[rows.length - 1] : null;
  }

  function getLastBubbleId(bubble) {
    if (!bubble) return null;
    const dataId = bubble.getAttribute('data-id') || bubble.dataset.id || bubble.querySelector('[data-id]')?.getAttribute('data-id');
    if (dataId) return dataId;

    const preText = bubble.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || bubble.getAttribute('data-pre-plain-text');
    const text = (bubble.innerText || '').slice(0, 40).trim();
    return `${preText || ''}_${text}`;
  }

  function isBubbleIncoming(bubble) {
    if (!bubble) return false;

    // 1. Direct data-id prefix
    const dataId = bubble.getAttribute('data-id') || bubble.dataset.id || bubble.querySelector('[data-id]')?.getAttribute('data-id') || '';
    if (dataId.startsWith('false_')) return true;
    if (dataId.startsWith('true_')) return false;

    // 2. Class check
    const classStr = (bubble.className || '') + ' ' + (bubble.firstElementChild?.className || '');
    if (classStr.includes('message-in')) return true;
    if (classStr.includes('message-out')) return false;

    // 3. Pre-plain-text header: [time, date] Sender:
    const preTextEl = bubble.querySelector('[data-pre-plain-text]') || (bubble.hasAttribute('data-pre-plain-text') ? bubble : null);
    if (preTextEl) {
      const preText = preTextEl.getAttribute('data-pre-plain-text') || '';
      if (preText.includes('You:')) return false;
      if (preText.length > 0) return true;
    }

    // 4. Check for outgoing delivery / read tick marks (ticks only ever exist on outgoing messages)
    const hasTick = bubble.querySelector(
      'span[data-icon*="check"], span[data-testid*="check"], span[data-icon="msg-time"], [data-testid="msg-check"], [data-testid="msg-dblcheck"]'
    );
    if (hasTick) return false;

    // 5. If it's a message bubble inside main chat and has no checkmark and isn't out, it's incoming
    const hasMsgContent = bubble.querySelector('.copyable-text, [data-testid="bubble-message-text"], span[dir="ltr"], span[dir="auto"]');
    if (hasMsgContent && !hasTick) {
      return true;
    }

    return false;
  }

  // Auto-Reply Detection: checks if the latest message bubble in active chat is an incoming reply
  function checkActiveChatForReply(activeSnooze) {
    if (!activeSnooze || activeSnooze.status !== 'awaiting') return false;
    const lastBubble = getLastMessageBubble();
    if (!lastBubble) return false;

    const currentId = getLastBubbleId(lastBubble);
    const isIncoming = isBubbleIncoming(lastBubble);

    // If we recorded the last seen message ID at snooze creation time:
    if (activeSnooze.lastSeenMessageId) {
      if (currentId === activeSnooze.lastSeenMessageId) {
        return false; // Still the same message, no new reply
      }
      if (isIncoming) {
        console.log('[PingLater] Auto-Reply Detected! New incoming message from:', activeSnooze.contactName);
        resolveSnoozeManual(activeSnooze.id);
        showPingLaterToast('🎉', `${activeSnooze.contactName} replied! "Awaiting Reply" cleared.`);
        return true;
      }
      return false;
    }

    // Fallback: If latest bubble is incoming, contact replied!
    if (isIncoming) {
      console.log('[PingLater] Auto-Reply Detected! Latest message is incoming from:', activeSnooze.contactName);
      resolveSnoozeManual(activeSnooze.id);
      showPingLaterToast('🎉', `${activeSnooze.contactName} replied! "Awaiting Reply" cleared.`);
      return true;
    }
    return false;
  }

  // Watches active chat for incoming message bubbles
  function initReplyObserver() {
    const mainChat = document.querySelector('#main');
    if (!mainChat) return;

    if (activeChatObserver) {
      activeChatObserver.disconnect();
    }

    activeChatObserver = new MutationObserver(() => {
      const activeSnooze = getActiveSnoozeForCurrentChat();
      if (activeSnooze && activeSnooze.status === 'awaiting') {
        checkActiveChatForReply(activeSnooze);
      }
    });

    activeChatObserver.observe(mainChat, { childList: true, subtree: true });
  }

  function showPingLaterToast(icon, message, durationMs = 4000) {
    const existing = document.getElementById('pinglater-toast-banner');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'pinglater-toast-banner';
    toast.innerHTML = `
      <span class="pinglater-toast-icon">${icon}</span>
      <span class="pinglater-toast-msg">${escapeHtml(message)}</span>
      <button type="button" class="pinglater-toast-close" title="Close">✕</button>
    `;

    toast.querySelector('.pinglater-toast-close')?.addEventListener('click', () => toast.remove());
    document.body.appendChild(toast);

    setTimeout(() => {
      if (document.body.contains(toast)) {
        toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, -10px)';
        setTimeout(() => toast.remove(), 300);
      }
    }, durationMs);
  }

  // ==========================================
  // LEFT CHAT LIST BADGES (Main list & Archived Drawer)
  // Shows live ticking progress pills & warning icons on WhatsApp conversation list
  // ==========================================
  function updateLeftChatListBadges() {
    if (!snoozes || snoozes.length === 0) {
      document.querySelectorAll('.pinglater-chatlist-badge').forEach((b) => b.remove());
      return;
    }

    const now = Date.now();
    const activeSnoozes = snoozes.filter((s) => ['awaiting', 'due'].includes(s.status));

    // Clean up any stray badges that aren't inside valid contact rows
    document.querySelectorAll('.pinglater-chatlist-badge').forEach((b) => {
      if (!b.closest('#pane-side div[role="listitem"], #side div[role="listitem"], div[role="row"], div[data-testid="cell-frame-container"]')) {
        b.remove();
      }
    });

    // Query all distinct conversation rows across main list, #side, and the Archived drawer
    const rowSelectors = [
      '#pane-side div[role="listitem"]',
      'div[data-animate-drawer-panel="true"] div[role="listitem"]',
      'div[aria-label*="Archived"] div[role="listitem"]',
      'div[aria-label*="archived"] div[role="listitem"]',
      '#side div[role="listitem"]',
      '#pane-side div[role="row"]',
      'div[data-animate-drawer-panel="true"] div[role="row"]'
    ];

    const rawRows = Array.from(document.querySelectorAll(rowSelectors.join(', ')));
    // Filter to top-level rows (never nested children of another matched row)
    const rows = rawRows.filter((r) => {
      return !r.parentElement?.closest(rowSelectors.join(', '));
    });

    rows.forEach((row) => {
      // Purge any duplicate badges on this row
      const existingBadges = row.querySelectorAll('.pinglater-chatlist-badge');
      if (existingBadges.length > 1) {
        for (let i = 1; i < existingBadges.length; i++) {
          existingBadges[i].remove();
        }
      }
      let existingBadge = existingBadges[0] || null;

      // 1. Get contact name or phone (Strictly ignore any PingLater injected badge elements!)
      let contactTitle = '';
      const titleEl =
        row.querySelector('[data-testid="cell-frame-title"] span') ||
        row.querySelector('[data-testid="cell-frame-title"]') ||
        row.querySelector('div[role="gridcell"] span[dir="auto"]') ||
        row.querySelector('span[title]:not([class*="pinglater"]):not([class*="pinglater"] *)') ||
        row.querySelector('span[dir="auto"]:not([class*="pinglater"]):not([class*="pinglater"] *)');

      if (titleEl) {
        contactTitle = (titleEl.getAttribute('title') || titleEl.textContent || '').trim();
      }

      if (!contactTitle) {
        // Fallback: search text lines excluding any PingLater badge text
        const clone = row.cloneNode(true);
        clone.querySelectorAll('.pinglater-chatlist-badge').forEach((b) => b.remove());
        const textLines = (clone.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
        contactTitle = textLines[0] || '';
      }

      if (!contactTitle) return;

      const cleanPhone = contactTitle.replace(/\D/g, '');
      const lowerTitle = contactTitle.toLowerCase();

      // Check if this row is the "Archived" folder header
      const isArchivedHeader =
        lowerTitle === 'archived' ||
        lowerTitle.startsWith('archived') ||
        row.querySelector('[data-testid="archived"]') !== null ||
        row.querySelector('span[data-testid="archived-icon"]') !== null;

      if (isArchivedHeader) {
        // Only count snoozes that are NOT currently displayed on the main visible list
        const hiddenSnoozes = activeSnoozes.filter((s) => {
          const sName = (s.contactName || '').trim().toLowerCase();
          const sPhone = String(s.phone || '').replace(/\D/g, '');
          const mainPane = document.getElementById('pane-side');
          if (!mainPane) return true;
          const titles = mainPane.querySelectorAll('[data-testid="cell-frame-title"], div[role="gridcell"] span[dir="auto"]');
          for (const t of titles) {
            const txt = (t.getAttribute('title') || t.textContent || '').trim().toLowerCase();
            if (sName && sName.length >= 2 && (txt === sName || txt.includes(sName))) return false;
            if (sPhone && txt.replace(/\D/g, '').endsWith(sPhone)) return false;
          }
          return true;
        });

        if (hiddenSnoozes.length > 0) {
          const dueCount = hiddenSnoozes.filter((s) => s.status === 'due' || (s.dueAt && new Date(s.dueAt).getTime() <= now)).length;
          const badgeClass = dueCount > 0 ? 'pinglater-chatlist-badge due' : 'pinglater-chatlist-badge awaiting';
          const labelText = dueCount > 0 ? `⚠️ ${dueCount} DUE` : `⏳ ${hiddenSnoozes.length} snoozed`;

          if (existingBadge) {
            existingBadge.className = badgeClass;
            const txt = existingBadge.querySelector('.pinglater-badge-txt');
            if (txt) txt.textContent = labelText;
          } else {
            if (getComputedStyle(row).position === 'static') {
              row.style.position = 'relative';
            }
            const badge = document.createElement('span');
            badge.className = badgeClass;
            badge.setAttribute('data-tooltip', 'PingLater: Active follow-up timers in archive');
            badge.innerHTML = `<span class="pinglater-badge-txt">${labelText}</span>`;
            row.appendChild(badge);
          }
        } else if (existingBadge) {
          existingBadge.remove();
        }
        return;
      }

      // 2. Find matching snooze for individual contact
      const match = snoozes.find((s) => {
        if (!['awaiting', 'due'].includes(s.status)) return false;
        const sPhone = String(s.phone || '').replace(/\D/g, '');
        const sName = (s.contactName || '').trim().toLowerCase();

        // Phone match
        if (sPhone && cleanPhone && (cleanPhone === sPhone || cleanPhone.endsWith(sPhone) || sPhone.endsWith(cleanPhone))) {
          return true;
        }
        // Name match (avoid matching empty strings)
        if (sName && sName.length >= 2 && lowerTitle && (sName === lowerTitle || lowerTitle.includes(sName) || sName.includes(lowerTitle))) {
          return true;
        }
        return false;
      });

      if (match) {
        // Auto-reply detection on left list: check WhatsApp's REAL unread badge only (never match our own elements!)
        const unreadEl =
          row.querySelector('span[data-testid="icon-unread-count"]') ||
          row.querySelector('div[data-testid="icon-unread-count"]') ||
          row.querySelector('span[aria-label*="unread"]') ||
          row.querySelector('div[aria-label*="unread"]');

        if (unreadEl && unreadEl.textContent.trim()) {
          const unreadCount = parseInt(unreadEl.textContent.trim(), 10);
          if (!isNaN(unreadCount) && unreadCount > 0) {
            console.log('[PingLater] Incoming reply detected on chat list row for:', match.contactName);
            resolveSnoozeManual(match.id);
            showPingLaterToast('🎉', `${match.contactName} replied! "Awaiting Reply" reminder automatically cleared.`);
            return;
          }
        }

        const isDue = match.status === 'due' || (match.dueAt && new Date(match.dueAt).getTime() <= now);
        const progressPct = calculateSnoozeProgress(match);
        const badgeClass = isDue ? 'pinglater-chatlist-badge due' : 'pinglater-chatlist-badge awaiting';
        const labelText = isDue ? '⚠️ OVERDUE 0s' : `⏳ ${formatRemainingTime(match.dueAt)}`;

        if (existingBadge && existingBadge.querySelector('.pinglater-mini-fill')) {
          existingBadge.className = badgeClass;
          const bar = existingBadge.querySelector('.pinglater-mini-fill');
          if (bar) bar.style.width = `${progressPct}%`;
          const txt = existingBadge.querySelector('.pinglater-badge-txt');
          if (txt) txt.textContent = labelText;
        } else {
          if (existingBadge) existingBadge.remove();
          if (getComputedStyle(row).position === 'static') {
            row.style.position = 'relative';
          }

          const badge = document.createElement('span');
          badge.className = badgeClass;
          // Use data-tooltip instead of title attribute so row.querySelector('span[title]') NEVER matches our badge!
          badge.setAttribute('data-tooltip', `PingLater: Awaiting Reply (${match.durationHours || 48}h snooze, ${progressPct}% elapsed)`);
          badge.innerHTML = `
            <span class="pinglater-mini-bar"><span class="pinglater-mini-fill" style="width: ${progressPct}%"></span></span>
            <span class="pinglater-badge-txt">${labelText}</span>
          `;

          row.appendChild(badge);
        }
      } else if (existingBadge) {
        existingBadge.remove();
      }
    });
  }

  // ==========================================
  // TEXT SELECTION -> SAVE AS SNIPPET
  // ==========================================
  let selectionSnippetBtn = null;
  let saveSnippetModal = null;
  let currentSelectedText = '';

  function getOrCreateSelectionSnippetBtn() {
    if (selectionSnippetBtn && document.body.contains(selectionSnippetBtn)) {
      return selectionSnippetBtn;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'pinglater-selection-snippet-btn';
    btn.style.display = 'none';
    btn.innerHTML = `<span>⚡</span><span>Save as Snippet</span>`;
    document.body.appendChild(btn);
    selectionSnippetBtn = btn;

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSaveSnippetModal(currentSelectedText);
      hideSelectionSnippetBtn();
    });

    return btn;
  }

  function hideSelectionSnippetBtn() {
    if (selectionSnippetBtn) {
      selectionSnippetBtn.style.display = 'none';
    }
  }

  function openSaveSnippetModal(text) {
    if (!text) return;

    if (saveSnippetModal && document.body.contains(saveSnippetModal)) {
      saveSnippetModal.remove();
      saveSnippetModal = null;
    }

    const overlay = document.createElement('div');
    overlay.id = 'pinglater-save-snippet-overlay';

    // Suggest a shortcode from first word
    const firstWord = text.trim().split(/\s+/)[0].slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, '') || 'gf';

    overlay.innerHTML = `
      <div class="pinglater-modal-card">
        <div class="pinglater-modal-header">
          <h3>⚡ Save Selected Text as Snippet</h3>
          <button type="button" class="pinglater-toast-close" id="btnPinglaterCloseModal">✕</button>
        </div>
        <div class="pinglater-modal-body">
          <div class="pinglater-form-group">
            <label class="pinglater-form-label">Snippet Text Content:</label>
            <textarea id="pinglaterSnippetText" class="pinglater-form-input" rows="4" style="resize:vertical;">${escapeHtml(text)}</textarea>
          </div>
          <div class="pinglater-form-group">
            <label class="pinglater-form-label">Shortcut Trigger (e.g. /gf, /cal, /pricing):</label>
            <div style="display:flex; align-items:center; position:relative;">
              <span style="position:absolute; left:10px; font-weight:800; color:#15803D; font-size:15px;">/</span>
              <input type="text" id="pinglaterShortcutInput" class="pinglater-form-input" style="padding-left:24px; font-weight:700; width:100%;" placeholder="e.g. gf" value="${firstWord}">
            </div>
          </div>
          <div class="pinglater-form-group">
            <label class="pinglater-form-label">Template Title:</label>
            <input type="text" id="pinglaterTitleInput" class="pinglater-form-input" placeholder="e.g. Quick Greeting" value="Snippet: ${escapeHtml(text.slice(0, 24))}...">
          </div>
        </div>
        <div class="pinglater-modal-footer">
          <button type="button" class="pinglater-btn-secondary" id="btnPinglaterCancelSnippet">Cancel</button>
          <button type="button" class="pinglater-btn-primary" id="btnPinglaterConfirmSnippet">💾 Save Snippet</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    saveSnippetModal = overlay;

    const closeBtn = overlay.querySelector('#btnPinglaterCloseModal');
    const cancelBtn = overlay.querySelector('#btnPinglaterCancelSnippet');
    const saveBtn = overlay.querySelector('#btnPinglaterConfirmSnippet');
    const shortcutInput = overlay.querySelector('#pinglaterShortcutInput');
    const titleInput = overlay.querySelector('#pinglaterTitleInput');
    const snippetTextInput = overlay.querySelector('#pinglaterSnippetText');

    function closeModal() {
      overlay.remove();
      saveSnippetModal = null;
    }

    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    function executeSaveSnippet() {
      const body = (snippetTextInput ? snippetTextInput.value : '').trim();
      let shortcut = (shortcutInput ? shortcutInput.value : '').trim().replace(/^\/+/, '').toLowerCase();
      const title = (titleInput ? titleInput.value : '').trim() || (shortcut ? `/${shortcut}` : 'Quick Snippet');

      if (!body) {
        showPingLaterToast('⚠️', 'Please enter some text for your snippet.');
        return;
      }
      if (!shortcut) {
        shortcut = 'snippet';
      }

      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '⏳ Saving...';
      }

      const newTpl = {
        id: `tpl_quick_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        title: title,
        category: 'Quick Snippets',
        shortcut: shortcut,
        body: body,
        variables: body.includes('{{name}}') ? ['name'] : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      try {
        // 1. Immediately update in-memory templates so /shortcut works right away in this active chat
        if (!Array.isArray(templates)) templates = [];
        const existingIdx = templates.findIndex((t) => t && (t.shortcut || '').toLowerCase() === shortcut);
        if (existingIdx >= 0) {
          templates[existingIdx] = newTpl;
        } else {
          templates.push(newTpl);
        }

        // 2. Persist to chrome.storage.local
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['pinglater_templates'], (res) => {
            let list = (res && Array.isArray(res.pinglater_templates)) ? res.pinglater_templates : [];
            const idx = list.findIndex((t) => t && (t.shortcut || '').toLowerCase() === shortcut);
            if (idx >= 0) {
              list[idx] = newTpl;
            } else {
              list.push(newTpl);
            }
            chrome.storage.local.set({ pinglater_templates: list }, () => {
              console.log('[PingLater] Snippet saved successfully to storage:', newTpl);
            });
          });
        }

        // 3. Notify background worker for storage sync
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'SAVE_TEMPLATE', template: newTpl });
        }

        // Visual confirmation toast
        showPingLaterToast('⚡', `Saved snippet! Type /${shortcut} in any chat to insert.`);
      } catch (err) {
        console.error('[PingLater] Error saving snippet:', err);
        showPingLaterToast('⚡', `Saved snippet! Type /${shortcut} to use.`);
      } finally {
        // 4. ALWAYS Remove modal and clear selection
        closeModal();
        hideSelectionSnippetBtn();
        try {
          window.getSelection()?.removeAllRanges();
        } catch (e) {}
      }
    }

    saveBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      executeSaveSnippet();
    });

    shortcutInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        executeSaveSnippet();
      }
    });

    titleInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        executeSaveSnippet();
      }
    });

    snippetTextInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        executeSaveSnippet();
      }
    });

    // Auto-focus and select shortcut input
    setTimeout(() => {
      shortcutInput?.focus();
      shortcutInput?.select();
    }, 100);
  }

  // Text selection listener on WhatsApp Web
  document.addEventListener('mouseup', (e) => {
    if (saveSnippetModal && saveSnippetModal.contains(e.target)) return;
    if (selectionSnippetBtn && selectionSnippetBtn.contains(e.target)) return;

    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        hideSelectionSnippetBtn();
        return;
      }

      const text = sel.toString().trim();
      if (text.length < 4 || text.length > 2000) {
        hideSelectionSnippetBtn();
        return;
      }

      currentSelectedText = text;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        hideSelectionSnippetBtn();
        return;
      }

      const btn = getOrCreateSelectionSnippetBtn();
      btn.style.display = 'flex';
      btn.style.top = `${Math.max(10, rect.top - 36)}px`;
      btn.style.left = `${Math.max(10, Math.min(window.innerWidth - 170, rect.left + rect.width / 2 - 75))}px`;
    }, 50);
  });

  // Periodic 1-second ticking timer for live countdown seconds & observer
  setInterval(() => {
    updateSnoozePill();
    updateLeftChatListBadges();
    if (!activeChatObserver && document.querySelector('#main')) {
      initReplyObserver();
    }
  }, 1000);

  // Immediate snap when switching chats or resizing window
  document.addEventListener('click', (e) => {
    if (snoozeContainer && snoozeContainer.contains(e.target)) {
      return;
    }
    setTimeout(updateSnoozePill, 100);
    setTimeout(updateLeftChatListBadges, 200);
  });

  window.addEventListener('resize', () => {
    updateSnoozePill();
    updateLeftChatListBadges();
  });

  // Initial calls on load
  setTimeout(() => {
    updateSnoozePill();
    updateLeftChatListBadges();
  }, 500);

  console.log('[PingLater] In-Chat Quick Snippets, Text-Selection Saver & Smart Snooze loaded.');
})();
