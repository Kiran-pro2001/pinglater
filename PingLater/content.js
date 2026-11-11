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
            <div class="pinglater-snooze-dropdown-item" data-hours="24">
              <span>⚡ In 24 hours</span>
              <span style="font-size:11px; opacity:0.6;">Tomorrow</span>
            </div>
            <div class="pinglater-snooze-dropdown-item" data-hours="48">
              <span>🎯 In 48 hours</span>
              <span class="recommended">Recommended</span>
            </div>
            <div class="pinglater-snooze-dropdown-item" data-hours="72">
              <span>📅 In 3 days</span>
              <span style="font-size:11px; opacity:0.6;">72h</span>
            </div>
            <div class="pinglater-snooze-dropdown-item" data-hours="168">
              <span>🗓️ In 1 week</span>
              <span style="font-size:11px; opacity:0.6;">7 days</span>
            </div>
          </div>
        </div>
      `;

      const trigger = container.querySelector('#pinglater-btn-trigger-snooze');
      const dropdown = container.querySelector('#pinglater-dropdown-snooze');

      trigger?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
      });

      container.querySelectorAll('.pinglater-snooze-dropdown-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const hours = parseInt(item.dataset.hours, 10) || 48;
          dropdown.style.display = 'none';
          container.dataset.currentState = '';
          createSnooze(hours);
        });
      });
    }
  }

  function createSnooze(hours) {
    const info = getCurrentChatInfo();
    if (!info) return;

    const now = new Date();
    const dueAt = new Date(now.getTime() + hours * 3600000).toISOString();
    const contactDisplayName = info.title || (info.phone ? `+${info.phone}` : 'Contact');

    const newSnooze = {
      id: `snooze_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      contactName: contactDisplayName,
      phone: info.phone || '',
      cleanIdentifier: info.cleanIdentifier,
      snoozedAt: now.toISOString(),
      dueAt: dueAt,
      durationHours: hours,
      status: 'awaiting',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    chrome.storage.local.get(['pinglater_snoozed_chats'], (res) => {
      const list = res.pinglater_snoozed_chats || [];
      list.unshift(newSnooze);
      chrome.storage.local.set({ pinglater_snoozed_chats: list }, () => {
        // Notify background to schedule alarm
        chrome.runtime.sendMessage({
          type: 'SCHEDULE_SNOOZE_ALARM',
          snoozeId: newSnooze.id,
          dueAt: newSnooze.dueAt,
          contactName: newSnooze.contactName,
          phone: newSnooze.phone
        });

        showPingLaterToast('💤', `Snoozed for ${hours}h! If ${contactDisplayName} replies, PingLater will auto-dismiss.`);
        updateSnoozePill();
      });
    });
  }

  function resolveSnoozeManual(id) {
    chrome.storage.local.get(['pinglater_snoozed_chats'], (res) => {
      const list = res.pinglater_snoozed_chats || [];
      const item = list.find((s) => s.id === id);
      if (item) {
        item.status = 'replied';
        item.repliedAt = new Date().toISOString();
        chrome.storage.local.set({ pinglater_snoozed_chats: list }, () => {
          chrome.runtime.sendMessage({ type: 'CANCEL_SNOOZE_ALARM', snoozeId: id });
          showPingLaterToast('🎉', `Marked as replied! Follow-up reminder cleared.`);
          updateSnoozePill();
        });
      }
    });
  }

  function cancelSnooze(id) {
    chrome.storage.local.get(['pinglater_snoozed_chats'], (res) => {
      const list = (res.pinglater_snoozed_chats || []).filter((s) => s.id !== id);
      chrome.storage.local.set({ pinglater_snoozed_chats: list }, () => {
        chrome.runtime.sendMessage({ type: 'CANCEL_SNOOZE_ALARM', snoozeId: id });
        showPingLaterToast('✕', `Snooze reminder cancelled.`);
        updateSnoozePill();
      });
    });
  }

  // Watches active chat for incoming message bubbles (.message-in)
  function initReplyObserver() {
    const mainChat = document.querySelector('#main');
    if (!mainChat) return;

    if (activeChatObserver) {
      activeChatObserver.disconnect();
    }

    activeChatObserver = new MutationObserver((mutations) => {
      let hasNewIncoming = false;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (
              node.classList?.contains('message-in') ||
              node.querySelector?.('.message-in') ||
              node.getAttribute?.('data-id')?.includes('false_')
            ) {
              hasNewIncoming = true;
              break;
            }
          }
        }
        if (hasNewIncoming) break;
      }

      if (hasNewIncoming) {
        const activeSnooze = getActiveSnoozeForCurrentChat();
        if (activeSnooze) {
          console.log('[PingLater] Incoming message detected for snoozed contact:', activeSnooze.contactName);
          resolveSnoozeManual(activeSnooze.id);
          showPingLaterToast('🎉', `${activeSnooze.contactName} just replied! "Awaiting Reply" reminder automatically cleared.`);
        }
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
  // LEFT CHAT LIST BADGES (#pane-side)
  // Shows live ticking progress pills & warning icons on WhatsApp conversation list
  // ==========================================
  function updateLeftChatListBadges() {
    const pane = document.querySelector('#pane-side');
    if (!pane || !snoozes || snoozes.length === 0) {
      if (pane) {
        pane.querySelectorAll('.pinglater-chatlist-badge').forEach((b) => b.remove());
      }
      return;
    }

    if (!pane.dataset.pinglaterListened) {
      pane.dataset.pinglaterListened = 'true';
      pane.addEventListener('scroll', () => setTimeout(updateLeftChatListBadges, 100), { passive: true });
    }

    const titleElements = pane.querySelectorAll('span[title]');
    const now = Date.now();

    titleElements.forEach((el) => {
      if (el.classList.contains('pinglater-chatlist-badge')) return;

      const title = (el.getAttribute('title') || el.textContent || '').trim();
      if (!title) return;

      const cleanPhone = title.replace(/\D/g, '');
      const lowerTitle = title.toLowerCase();

      // Find matching active or due snooze
      const match = snoozes.find((s) => {
        if (!['awaiting', 'due'].includes(s.status)) return false;
        if (cleanPhone && s.phone && String(s.phone).replace(/\D/g, '') === cleanPhone) return true;
        if (lowerTitle && s.contactName && s.contactName.trim().toLowerCase() === lowerTitle) return true;
        return false;
      });

      const parentContainer = el.parentElement;
      if (!parentContainer) return;

      let existingBadge = parentContainer.querySelector('.pinglater-chatlist-badge');

      if (match) {
        // Auto-reply detection on left list: check if WhatsApp shows an unread message badge on this row!
        const row = el.closest('div[role="listitem"]') || el.closest('div[role="row"]') || el.closest('div[tabindex="-1"]') || parentContainer.parentElement;
        if (row) {
          const unreadEl =
            row.querySelector('[aria-label*="unread"]') ||
            row.querySelector('[data-testid*="unread"]') ||
            row.querySelector('span[data-testid="icon-unread-count"]');
          if (unreadEl && unreadEl.textContent.trim() && !isNaN(parseInt(unreadEl.textContent.trim(), 10))) {
            console.log('[PingLater] Incoming reply detected on chat list row for:', match.contactName);
            resolveSnoozeManual(match.id);
            showPingLaterToast('🎉', `${match.contactName} replied! "Awaiting Reply" reminder automatically cleared.`);
            return;
          }
        }

        const isDue = match.status === 'due' || (match.dueAt && new Date(match.dueAt).getTime() <= now);
        const progressPct = calculateSnoozeProgress(match);
        const badgeClass = isDue ? 'pinglater-chatlist-badge due' : 'pinglater-chatlist-badge awaiting';
        const labelText = isDue ? '⚠️ OVERDUE' : `⏳ ${formatRemainingTime(match.dueAt)}`;

        if (existingBadge) {
          existingBadge.className = badgeClass;
          const bar = existingBadge.querySelector('.pinglater-mini-fill');
          if (bar) bar.style.width = `${progressPct}%`;
          const txt = existingBadge.querySelector('.pinglater-badge-txt');
          if (txt) txt.textContent = labelText;
        } else {
          const badge = document.createElement('span');
          badge.className = badgeClass;
          badge.title = `PingLater: Awaiting Reply (${match.durationHours || 48}h snooze, ${progressPct}% elapsed)`;
          badge.innerHTML = `
            <span class="pinglater-mini-bar"><span class="pinglater-mini-fill" style="width: ${progressPct}%"></span></span>
            <span class="pinglater-badge-txt">${labelText}</span>
          `;
          el.insertAdjacentElement('afterend', badge);
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
    }

    const overlay = document.createElement('div');
    overlay.id = 'pinglater-save-snippet-overlay';

    // Suggest a shortcode from first word
    const firstWord = text.trim().split(/\s+/)[0].slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, '');

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

    overlay.querySelector('#btnPinglaterCloseModal')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#btnPinglaterCancelSnippet')?.addEventListener('click', () => overlay.remove());

    overlay.querySelector('#btnPinglaterConfirmSnippet')?.addEventListener('click', () => {
      const body = overlay.querySelector('#pinglaterSnippetText').value.trim();
      let shortcut = overlay.querySelector('#pinglaterShortcutInput').value.trim().replace(/^\/+/, '').toLowerCase();
      const title = overlay.querySelector('#pinglaterTitleInput').value.trim() || 'Quick Snippet';

      if (!body) {
        alert('Please enter snippet text.');
        return;
      }
      if (!shortcut) {
        shortcut = 'snippet';
      }

      chrome.storage.local.get(['pinglater_templates'], (res) => {
        const list = res.pinglater_templates || [];
        const newTpl = {
          id: `tpl_quick_${Date.now()}`,
          title: title,
          category: 'Quick Snippets',
          shortcut: shortcut,
          body: body,
          variables: body.includes('{{name}}') ? ['name'] : [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        list.push(newTpl);
        chrome.storage.local.set({ pinglater_templates: list }, () => {
          templates = list;
          overlay.remove();
          showPingLaterToast('⚡', `Saved snippet! Type /${shortcut} in any chat to insert.`);
        });
      });
    });
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
