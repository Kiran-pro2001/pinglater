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
      });
    }
  }

  // Real-time storage listener for snoozes
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.pinglater_snoozed_chats) {
        snoozes = changes.pinglater_snoozed_chats.newValue || [];
        updateSnoozePill();
      }
    });
  }

  loadSnoozes();

  function getCurrentChatInfo() {
    try {
      const header = document.querySelector('#main header') || document.querySelector('header');
      if (!header) return null;

      const titleEl =
        header.querySelector('span[data-testid="conversation-info-header-chat-title"]') ||
        header.querySelector('div[role="button"] span[title]') ||
        header.querySelector('span[dir="auto"]');

      if (!titleEl) return null;

      const rawTitle = (titleEl.getAttribute('title') || titleEl.innerText || '').trim();
      const phoneDigits = rawTitle.replace(/\D/g, '');
      const isPhoneTitle = phoneDigits.length >= 7 && /^[\d\s+\-()]+$/.test(rawTitle);

      return {
        title: rawTitle,
        contactName: isPhoneTitle ? '' : rawTitle.split(/\s+/)[0],
        phone: isPhoneTitle ? phoneDigits : '',
        cleanIdentifier: isPhoneTitle ? phoneDigits : rawTitle.toLowerCase()
      };
    } catch (e) {
      return null;
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
    const totalMinutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h left`;
    }
    if (hours > 0) {
      return `${hours}h ${mins}m left`;
    }
    return `${mins}m left`;
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
    if (!info) {
      if (snoozeContainer) snoozeContainer.style.display = 'none';
      return;
    }

    const container = getOrCreateSnoozeContainer();
    container.style.display = 'block';

    const activeSnooze = getActiveSnoozeForCurrentChat();

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

      container.querySelector('.btn-replied')?.addEventListener('click', () => {
        resolveSnoozeManual(activeSnooze.id);
      });

      container.querySelector('.btn-cancel')?.addEventListener('click', () => {
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
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
      });

      container.querySelectorAll('.pinglater-snooze-dropdown-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const hours = parseInt(item.dataset.hours, 10) || 48;
          dropdown.style.display = 'none';
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

  // Periodic polling for chat switches and observer attachment
  setInterval(() => {
    updateSnoozePill();
    if (!activeChatObserver && document.querySelector('#main')) {
      initReplyObserver();
    }
  }, 2000);

  console.log('[PingLater] In-Chat Quick Snippets & Smart Snooze loaded on WhatsApp Web.');
})();
