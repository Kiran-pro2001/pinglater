/**
 * PingLater - Full Dashboard Hub Controller (Module 7)
 * Manages the central management workspace: Batches, Ingestion Wizard,
 * 1-to-1 Follow-ups, Templates Manager, and Settings/Backup.
 */

import { StorageService, BATCH_STATUS, RECIPIENT_STATUS, SNOOZE_STATUS } from './utils/storage.js';
import { parseCSV, autoDetectColumns, normalizePhoneNumber, parsePastedText, processRecipientsList, COMMON_COUNTRY_CODES } from './utils/normalizer.js';
import { extractVariables, renderTemplate, validateBatchVariables, renderBatchRecipients } from './utils/template.js';
import { WhatsAppOrchestrator } from './utils/whatsapp.js';
import { SoundPlayer } from './utils/audio.js';
import { calculateNextRecurringDate, calculateTotalCycles, formatRecurrenceSummary, RECURRING_FREQUENCY } from './utils/recurring.js';
import { fetchGoogleSheetCsv, writeBackToGoogleSheet, GOOGLE_APPS_SCRIPT_TEMPLATE } from './utils/sheets.js';
import {
  CADENCE_STATUS,
  PRESET_CADENCES,
  createCadenceBlueprint,
  enrollContactInCadence,
  enrollBatchInCadence,
  recordStepSent,
  recordContactReplied,
  checkDueEnrollments,
  pauseEnrollment,
  resumeEnrollment,
  cancelEnrollment,
  calculateCadenceMetrics,
  formatDelayText,
  interpolateCadenceMessage,
  normalizeCadencePhone
} from './utils/cadence.js';

// Application State
let currentTab = 'tab-quick-ping';
let currentBatches = [];
let currentTemplates = [];
let currentSettings = null;
let currentCadenceBlueprints = [];
let currentCadenceEnrollments = [];

// Wizard State
let wizardRawRows = [];
let wizardHeaders = [];
let wizardProcessedRecipients = [];
let wizardSampleIndex = 0;
let currentWizardSheetSync = null;

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  await StorageService.initDefaults();
  currentSettings = await StorageService.getSettings();

  setupNavigation();
  setupBatchesTab();
  setupWizardTab();
  setupQuickPingTab();
  setupTemplatesTab();
  setupSnippetsTab();
  setupSnoozeTab();
  setupCadencesTab();
  setupSettingsTab();
  setupEditScheduleModal();
  setupSkippedModal();
  setupGlobalActions();

  // Load initial data
  await refreshBatchesList();
  await refreshTemplatesList();
  await refreshSnippetsList();
  await refreshSnoozeView();
  await refreshCadencesData();
  populateSettingsForm();
  updateLiveClock();
  setInterval(updateLiveClock, 1000);

  // Sync with background and sidepanel events
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'BATCH_COMPLETED' || msg.type === 'SCHEDULE_BATCH') {
        refreshBatchesList();
      }
    });
  }
});

// ==========================================
// TAB NAVIGATION
// ==========================================

function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  // Action buttons that navigate
  document.getElementById('btnNewBatchTop')?.addEventListener('click', () => switchTab('tab-wizard'));
  document.getElementById('btnQuickFollowupTop')?.addEventListener('click', () => switchTab('tab-quick-ping'));
  document.getElementById('btnEmptyCreateBatch')?.addEventListener('click', () => switchTab('tab-wizard'));
  document.getElementById('btnReviewOverdue')?.addEventListener('click', () => {
    switchTab('tab-batches');
    const activePill = document.querySelector('.pill[data-filter="active"]');
    if (activePill) activePill.click();
  });
}

function switchTab(tabId) {
  currentTab = tabId;

  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });

  document.querySelectorAll('.tab-pane').forEach((pane) => {
    pane.classList.toggle('active', pane.id === tabId);
  });

  if (tabId === 'tab-batches') refreshBatchesList();
  if (tabId === 'tab-templates') refreshTemplatesList();
  if (tabId === 'tab-snippets') refreshSnippetsList();
  if (tabId === 'tab-snooze') refreshSnoozeView();
  if (tabId === 'tab-cadences') refreshCadencesData();
  if (tabId === 'tab-wizard') checkWizardActiveBatch();
}

function updateLiveClock() {
  const clockEls = document.querySelectorAll('.live-clock-span');
  const now = new Date();
  const text = `🕒 ${now.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  clockEls.forEach((el) => (el.textContent = text));

  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const wizardClock = document.getElementById('wizardCurrentClock');
  if (wizardClock) wizardClock.textContent = `🕒 Current: ${timeStr}`;

  const singleClock = document.getElementById('singleCurrentClock');
  if (singleClock) singleClock.textContent = `🕒 Current: ${timeStr}`;

  // Keep relative countdown displays updated
  if (typeof updateTimingDisplayFromInput === 'function') {
    updateTimingDisplayFromInput();
  }
  if (typeof updateWizardTimingDisplay === 'function') {
    updateWizardTimingDisplay();
  }
}

// ==========================================
// TAB 1: BATCHES & FOLLOW-UPS
// ==========================================

let batchFilter = 'all';
let batchSearchQuery = '';

function setupBatchesTab() {
  const filterPills = document.querySelectorAll('.filter-pills .pill');
  filterPills.forEach((p) => {
    p.addEventListener('click', () => {
      filterPills.forEach((x) => x.classList.remove('active'));
      p.classList.add('active');
      batchFilter = p.getAttribute('data-filter') || 'all';
      renderBatchesGrid();
    });
  });

  const searchInput = document.getElementById('batchSearchInput');
  searchInput?.addEventListener('input', (e) => {
    batchSearchQuery = e.target.value.toLowerCase().trim();
    renderBatchesGrid();
  });
}

async function refreshBatchesList() {
  currentBatches = await StorageService.getBatches();
  updateBatchesCountBadges();
  renderBatchesGrid();
  checkWizardActiveBatch();
}

function checkWizardActiveBatch() {
  const notice = document.getElementById('wizardActiveBatchNotice');
  const titleEl = document.getElementById('wizardActiveBatchTitle');
  if (!notice || !titleEl) return;

  const inProgress = currentBatches.find((b) => b.status === BATCH_STATUS.IN_PROGRESS);
  if (inProgress) {
    const total = inProgress.recipients ? inProgress.recipients.length : 0;
    const sent = inProgress.recipients ? inProgress.recipients.filter((r) => r.status === 'sent').length : 0;
    titleEl.textContent = `"${inProgress.title}" (${sent}/${total} sent)`;
    notice.classList.remove('hidden');

    const btnEnd = document.getElementById('btnWizardEndActiveJob');
    if (btnEnd) {
      btnEnd.onclick = async () => {
        if (!confirm(`Are you sure you want to end active job "${inProgress.title}"? Your progress will be saved and batch marked as completed.`)) return;

        await StorageService.updateBatch(inProgress.id, {
          status: BATCH_STATUS.COMPLETED,
          completedAt: new Date().toISOString()
        });

        // Cancel alarm
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'CANCEL_BATCH_ALARM', batchId: inProgress.id });
          chrome.runtime.sendMessage({ type: 'BATCH_COMPLETED', batchId: inProgress.id });
        }

        notice.classList.add('hidden');
        await refreshBatchesList();
        alert(`✅ Active job "${inProgress.title}" ended and marked completed!`);
      };
    }
  } else {
    notice.classList.add('hidden');
  }
}

function updateBatchesCountBadges() {
  const all = currentBatches.length;
  const active = currentBatches.filter((b) => b.status === BATCH_STATUS.IN_PROGRESS || b.status === BATCH_STATUS.OVERDUE).length;
  const recurring = currentBatches.filter((b) => b.isRecurring && b.status !== BATCH_STATUS.COMPLETED && b.status !== BATCH_STATUS.CANCELLED).length;
  const scheduled = currentBatches.filter((b) => b.status === BATCH_STATUS.SCHEDULED).length;
  const completed = currentBatches.filter((b) => b.status === BATCH_STATUS.COMPLETED).length;

  document.getElementById('countAll').textContent = all;
  document.getElementById('countActive').textContent = active;
  if (document.getElementById('countRecurring')) {
    document.getElementById('countRecurring').textContent = recurring;
  }
  document.getElementById('countScheduled').textContent = scheduled;
  document.getElementById('countCompleted').textContent = completed;

  // Sidebar badge for active/overdue items
  const navBadge = document.getElementById('navDueBadge');
  if (active > 0) {
    navBadge.textContent = active;
    navBadge.classList.remove('hidden');
  } else {
    navBadge.classList.add('hidden');
  }

  // Top overdue banner
  const overdueBatches = currentBatches.filter((b) => b.status === BATCH_STATUS.OVERDUE);
  const overdueBanner = document.getElementById('topOverdueBanner');
  if (overdueBatches.length > 0) {
    overdueBanner.classList.remove('hidden');
    document.getElementById('overdueBannerTitle').textContent = `${overdueBatches.length} overdue follow-up batch(es) need your attention!`;
  } else {
    overdueBanner.classList.add('hidden');
  }
}

function renderBatchesGrid() {
  const container = document.getElementById('batchesContainer');
  const fallback = document.getElementById('batchesEmptyFallback');
  container.innerHTML = '';

  let filtered = currentBatches.filter((b) => {
    if (batchFilter === 'active') return b.status === BATCH_STATUS.IN_PROGRESS || b.status === BATCH_STATUS.OVERDUE;
    if (batchFilter === 'recurring') return b.isRecurring;
    if (batchFilter === 'scheduled') return b.status === BATCH_STATUS.SCHEDULED;
    if (batchFilter === 'completed') return b.status === BATCH_STATUS.COMPLETED;
    return true;
  });

  if (batchSearchQuery) {
    filtered = filtered.filter((b) => (b.title || '').toLowerCase().includes(batchSearchQuery));
  }

  if (filtered.length === 0) {
    fallback.classList.remove('hidden');
    container.classList.add('hidden');
    return;
  }

  fallback.classList.add('hidden');
  container.classList.remove('hidden');

  filtered.forEach((batch) => {
    const card = document.createElement('div');
    card.className = `batch-card ${batch.status === BATCH_STATUS.OVERDUE ? 'card-overdue' : ''}`;

    const total = batch.recipients ? batch.recipients.length : 0;
    const sent = batch.recipients ? batch.recipients.filter((r) => r.status === RECIPIENT_STATUS.SENT).length : 0;
    const skipped = batch.recipients ? batch.recipients.filter((r) => r.status === RECIPIENT_STATUS.SKIPPED).length : 0;
    const processed = sent + skipped;
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

    const scheduledDateStr = batch.scheduledAt
      ? new Date(batch.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
      : 'Unscheduled';

    const isRec = batch.isRecurring && batch.recurringConfig;
    const recurringBadge = isRec
      ? `<span class="badge badge-recurring">🔁 ${escapeHtml(batch.recurringConfig.frequency || 'RECURRING').toUpperCase()} (${batch.recurringConfig.currentCycle || 1}/${batch.recurringConfig.totalCycles || '?'})</span>`
      : '';

    card.innerHTML = `
      <div class="card-top-row">
        <h3 class="card-title">${escapeHtml(batch.title || 'Untitled Follow-up')}</h3>
        <div style="display:flex; gap:6px; align-items:center;">
          ${batch.sheetSync ? `<span class="badge-sheets-synced" title="Connected to Google Sheet">📊 Sheets Synced</span>` : ''}
          ${recurringBadge}
          <span class="badge badge-${batch.status}">${batch.status.replace('_', ' ')}</span>
        </div>
      </div>

      <div class="card-meta-row">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <span>${isRec ? `Next: ${scheduledDateStr}` : scheduledDateStr}</span>
        <span>•</span>
        <span>${isRec ? `Day ${batch.recurringConfig.currentCycle || 1} of ${batch.recurringConfig.totalCycles || '?'}` : `${total} Recipient${total !== 1 ? 's' : ''}`}</span>
      </div>

      <div class="batch-progress-bar">
        <div class="bar-track">
          <div class="bar-fill" style="width: ${percent}%"></div>
        </div>
        <div class="bar-meta">
          <span>${sent} Sent, ${skipped} Skipped</span>
          <span>${percent}%</span>
        </div>
      </div>

      <div class="card-actions-row">
        <button type="button" class="btn btn-primary btn-sm btn-start-batch" data-id="${batch.id}">
          ▶ Open Workspace
        </button>
        <div class="card-actions-secondary">
          ${batch.sheetSync ? `
          <button type="button" class="btn btn-outline btn-sm btn-resync-sheet" data-id="${batch.id}" title="Pull latest contacts from Google Sheet">
            🔄 Re-sync
          </button>
          ` : ''}
          ${skipped > 0 ? `
          <button type="button" class="btn btn-warning btn-sm btn-view-skipped" data-id="${batch.id}" title="View and Export ${skipped} Skipped Contacts">
            ⚠️ Skipped (${skipped})
          </button>
          ` : ''}
          <button type="button" class="btn btn-outline btn-sm btn-edit-batch" data-id="${batch.id}" title="Edit Schedule & Follow-up">
            ✏️ Edit
          </button>
          <button type="button" class="btn btn-outline btn-sm btn-export-batch" data-id="${batch.id}" title="Export CSV Report">
            📥 Report
          </button>
          <button type="button" class="btn btn-danger btn-sm btn-delete-batch" data-id="${batch.id}" title="Delete Batch">
            🗑️
          </button>
        </div>
      </div>
    `;

    // Start / Resume button
    card.querySelector('.btn-start-batch').addEventListener('click', () => {
      openBatchInSidePanel(batch.id);
    });

    // Re-sync with Google Sheet (Feature 4)
    card.querySelector('.btn-resync-sheet')?.addEventListener('click', async () => {
      const btn = card.querySelector('.btn-resync-sheet');
      if (btn) btn.textContent = '⏳ Syncing...';
      try {
        const res = await fetchGoogleSheetCsv(batch.sheetSync.sheetUrl);
        const parsed = parseCSV(res.csvText);
        const existingPhones = new Set((batch.recipients || []).map((r) => String(r.phone).replace(/\D/g, '')));

        let addedCount = 0;
        const newRecipients = [];
        const colMap = autoDetectColumns(parsed.headers);

        parsed.rows.forEach((row, i) => {
          const rawPhone = row[colMap.phoneCol] || row['Phone'] || row['Mobile'] || '';
          const norm = normalizePhoneNumber(rawPhone, currentSettings?.defaultCountryCode || '91');
          if (norm.isValid && !existingPhones.has(norm.formatted)) {
            existingPhones.add(norm.formatted);
            const name = row[colMap.nameCol] || row['Name'] || `Contact ${i + 1}`;
            const renderedMsg = renderTemplate(batch.templateBody, { ...row, name, phone: norm.formatted });
            newRecipients.push({
              name,
              phone: norm.formatted,
              rawPhone,
              status: RECIPIENT_STATUS.PENDING,
              customFields: row,
              renderedMessage: renderedMsg
            });
            addedCount++;
          }
        });

        if (addedCount > 0) {
          batch.recipients = [...(batch.recipients || []), ...newRecipients];
          batch.sheetSync.lastSyncedAt = new Date().toISOString();
          await StorageService.updateBatch(batch.id, {
            recipients: batch.recipients,
            sheetSync: batch.sheetSync
          });
          alert(`🎉 Re-synced successfully! Added ${addedCount} new contact(s) from your Google Sheet.`);
          refreshBatchesList();
        } else {
          alert('✓ Your batch is already up to date with the Google Sheet. No new contacts found.');
          if (btn) btn.textContent = '🔄 Re-sync';
        }
      } catch (err) {
        alert('Could not sync with Google Sheet: ' + err.message);
        refreshBatchesList();
      }
    });

    // View Skipped Contacts button
    card.querySelector('.btn-view-skipped')?.addEventListener('click', () => {
      openSkippedRecipientsModal(batch);
    });

    // Edit schedule button
    card.querySelector('.btn-edit-batch')?.addEventListener('click', () => {
      openEditScheduleModal(batch);
    });

    // Export button
    card.querySelector('.btn-export-batch').addEventListener('click', () => {
      downloadBatchCSV(batch);
    });

    // Delete button
    card.querySelector('.btn-delete-batch').addEventListener('click', async () => {
      if (confirm(`Are you sure you want to delete "${batch.title}"?`)) {
        await StorageService.deleteBatch(batch.id);
        chrome.runtime.sendMessage({ type: 'CANCEL_BATCH_ALARM', batchId: batch.id });
        refreshBatchesList();
      }
    });

    container.appendChild(card);
  });
}

async function openBatchInSidePanel(batchId) {
  try {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'LOAD_BATCH_IN_SIDEPANEL', batchId }).catch(() => {});
      }, 300);
      return;
    }
  } catch (e) {
    console.warn('[PingLater] Direct sidePanel.open failed:', e);
  }
  // Robust fallback window if browser blocks sidePanel.open on extension pages
  window.open(
    chrome.runtime.getURL(`sidepanel.html?batchId=${batchId}`),
    'PingLaterSidePanel',
    'width=420,height=760,left=' + (window.screen.width - 440) + ',top=80'
  );
}

// ==========================================
// TAB 2: NEW BATCH WIZARD
// ==========================================

function setupWizardTab() {
  const dropzone = document.getElementById('dropzoneArea');
  const fileInput = document.getElementById('csvFileInput');
  const btnModeCSV = document.getElementById('btnModeCSV');
  const btnModePaste = document.getElementById('btnModePaste');
  const btnModeSheets = document.getElementById('btnModeSheets');
  const pasteArea = document.getElementById('pasteArea');
  const sheetsSyncArea = document.getElementById('sheetsSyncArea');
  const btnProcessPaste = document.getElementById('btnProcessPaste');
  const rawPasteText = document.getElementById('rawPasteText');

  // Mode switching (CSV vs Paste vs Google Sheets)
  btnModeCSV.addEventListener('click', () => {
    btnModeCSV.classList.add('active');
    btnModePaste.classList.remove('active');
    btnModeSheets?.classList.remove('active');
    pasteArea.classList.add('hidden');
    sheetsSyncArea?.classList.add('hidden');
    const fileCard = document.getElementById('uploadedFileCard');
    if (fileCard && !fileCard.classList.contains('hidden')) {
      dropzone.classList.add('hidden');
    } else {
      dropzone.classList.remove('hidden');
    }
  });

  btnModePaste.addEventListener('click', () => {
    btnModePaste.classList.add('active');
    btnModeCSV.classList.remove('active');
    btnModeSheets?.classList.remove('active');
    dropzone.classList.add('hidden');
    sheetsSyncArea?.classList.add('hidden');
    document.getElementById('uploadedFileCard')?.classList.add('hidden');
    pasteArea.classList.remove('hidden');
  });

  btnModeSheets?.addEventListener('click', () => {
    btnModeSheets.classList.add('active');
    btnModeCSV.classList.remove('active');
    btnModePaste.classList.remove('active');
    dropzone.classList.add('hidden');
    pasteArea.classList.add('hidden');
    document.getElementById('uploadedFileCard')?.classList.add('hidden');
    sheetsSyncArea?.classList.remove('hidden');
  });

  // Initialize Apps Script snippet
  const appsScriptEl = document.getElementById('appsScriptCodeSnippet');
  if (appsScriptEl) {
    appsScriptEl.value = GOOGLE_APPS_SCRIPT_TEMPLATE;
  }

  // Copy Apps Script button
  const btnCopyScript = document.getElementById('btnCopyAppsScript');
  btnCopyScript?.addEventListener('click', () => {
    navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_TEMPLATE);
    btnCopyScript.textContent = '✓ Copied!';
    setTimeout(() => {
      btnCopyScript.textContent = '📋 Copy Script';
    }, 2500);
  });

  // Toggle webhook config section based on checkbox
  const chk2Way = document.getElementById('chkEnable2WayWriteback');
  const webhookSection = document.getElementById('webhookConfigSection');
  chk2Way?.addEventListener('change', () => {
    if (webhookSection) {
      webhookSection.style.display = chk2Way.checked ? 'block' : 'none';
    }
  });

  // Fetch Google Sheet button
  const btnFetchSheet = document.getElementById('btnFetchGoogleSheet');
  btnFetchSheet?.addEventListener('click', async () => {
    const urlInput = document.getElementById('googleSheetUrlInput');
    const webhookInput = document.getElementById('googleWebhookUrlInput');
    const statusBanner = document.getElementById('sheetsSyncStatusBanner');
    const sheetUrl = (urlInput?.value || '').trim();
    const webhookUrl = (webhookInput?.value || '').trim();
    const is2Way = chk2Way?.checked || false;

    if (!sheetUrl) {
      alert('Please paste your Google Sheet share link.');
      urlInput?.focus();
      return;
    }

    try {
      btnFetchSheet.disabled = true;
      btnFetchSheet.textContent = '⏳ Fetching...';
      if (statusBanner) {
        statusBanner.className = 'sheets-sync-status-success';
        statusBanner.textContent = 'Connecting to Google Sheets...';
        statusBanner.classList.remove('hidden');
      }

      const res = await fetchGoogleSheetCsv(sheetUrl);
      const parsed = parseCSV(res.csvText);

      if (!parsed.rows || parsed.rows.length === 0) {
        throw new Error('No contact rows found in this Google Sheet.');
      }

      // Show Uploaded File Card in Step 1
      const fileCard = document.getElementById('uploadedFileCard');
      const dropzoneArea = document.getElementById('dropzoneArea');
      const fileNameDisplay = document.getElementById('uploadedFileNameDisplay');
      const fileDetailsDisplay = document.getElementById('uploadedFileDetails');
      if (fileCard && dropzoneArea && fileNameDisplay && fileDetailsDisplay) {
        fileNameDisplay.textContent = `📊 Google Sheet (${res.sheetId.slice(0, 10)}...)`;
        fileDetailsDisplay.textContent = `${parsed.rows.length} contacts parsed • Live 2-Way Sync Enabled`;
        dropzoneArea.classList.add('hidden');
        sheetsSyncArea?.classList.add('hidden');
        fileCard.classList.remove('hidden');
      }

      // Auto-fill campaign title if empty
      const titleInput = document.getElementById('wizardBatchTitle');
      if (titleInput && !titleInput.value) {
        titleInput.value = `Google Sheet Campaign (${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })})`;
      }

      currentWizardSheetSync = {
        sheetUrl,
        sheetId: res.sheetId,
        gid: res.gid,
        webhookUrl: is2Way ? webhookUrl : '',
        twoWaySyncEnabled: is2Way && Boolean(webhookUrl),
        lastSyncedAt: new Date().toISOString()
      };

      if (statusBanner) {
        statusBanner.className = 'sheets-sync-status-success';
        statusBanner.textContent = `✓ Successfully loaded ${parsed.rows.length} contacts from Google Sheet!`;
      }

      handleParsedRows(parsed.headers, parsed.rows);
    } catch (err) {
      console.error('[PingLater] Google Sheet fetch error:', err);
      if (statusBanner) {
        statusBanner.className = 'sheets-sync-status-error';
        statusBanner.textContent = `❌ ${err.message}`;
        statusBanner.classList.remove('hidden');
      }
      alert('Error fetching Google Sheet: ' + err.message);
    } finally {
      btnFetchSheet.disabled = false;
      btnFetchSheet.textContent = '📥 Fetch Sheet';
    }
  });

  // Top CSV Confirmation Banner OK button
  document.getElementById('btnAcknowledgeCSV')?.addEventListener('click', () => {
    document.getElementById('csvSuccessBanner')?.classList.add('hidden');
    const target = document.getElementById('wizardStep2Card') || document.getElementById('wizardMessageBody') || document.getElementById('mappingCard');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Replace File button
  document.getElementById('btnChangeCSVFile')?.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  // Drag & drop handlers
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleCSVFile(e.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleCSVFile(e.target.files[0]);
    }
  });

  // Paste handler
  btnProcessPaste.addEventListener('click', () => {
    const text = rawPasteText.value.trim();
    if (!text) {
      alert('Please paste some contact lines first.');
      return;
    }
    const defaultCC = document.getElementById('selectDefaultCC')?.value || '91';
    const contacts = parsePastedText(text, defaultCC);
    if (contacts.length === 0) {
      alert('Could not find any valid phone numbers in the pasted text.');
      return;
    }

    // Convert into row objects
    const rows = contacts.map((c, i) => ({
      Name: c.name || `Contact ${i + 1}`,
      Phone: c.phone
    }));
    handleParsedRows(['Name', 'Phone'], rows);
  });

  // Column remapping change listeners
  document.getElementById('selectPhoneCol')?.addEventListener('change', reprocessWizardRecipients);
  document.getElementById('selectNameCol')?.addEventListener('change', reprocessWizardRecipients);
  document.getElementById('selectDefaultCC')?.addEventListener('change', reprocessWizardRecipients);

  // Message template dropdown
  const selectTemplateInWizard = document.getElementById('selectTemplateInWizard');
  selectTemplateInWizard?.addEventListener('change', (e) => {
    const tplId = e.target.value;
    if (tplId) {
      const found = currentTemplates.find((t) => t.id === tplId);
      if (found) {
        document.getElementById('wizardMessageBody').value = found.body;
        updateLivePreview();
      }
    }
  });

  // Message body input listener for live preview & validation
  const wizardMessageBody = document.getElementById('wizardMessageBody');
  wizardMessageBody?.addEventListener('input', () => {
    updateLivePreview();
  });

  // Sample navigator buttons
  document.getElementById('btnPrevSample')?.addEventListener('click', () => {
    if (wizardSampleIndex > 0) {
      wizardSampleIndex--;
      updateLivePreview();
    }
  });

  document.getElementById('btnNextSample')?.addEventListener('click', () => {
    if (wizardSampleIndex < wizardProcessedRecipients.length - 1) {
      wizardSampleIndex++;
      updateLivePreview();
    }
  });

  // Handle Wizard Timing Presets
  const wizardPresets = document.querySelectorAll('#wizardTimingPresets .btn-timing-preset');
  wizardPresets.forEach((btn) => {
    btn.addEventListener('click', () => {
      wizardPresets.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const presetKey = btn.getAttribute('data-wizard-preset');
      applyWizardTimingPreset(presetKey);
    });
  });

  document.getElementById('btnSyncWizardTime')?.addEventListener('click', () => {
    wizardPresets.forEach((b) => b.classList.remove('active'));
    document.querySelector('[data-wizard-preset="5m"]')?.classList.add('active');
    applyWizardTimingPreset('5m');
  });

  const wizardScheduleTime = document.getElementById('wizardScheduleTime');
  wizardScheduleTime?.addEventListener('input', () => {
    wizardPresets.forEach((b) => b.classList.remove('active'));
    updateWizardTimingDisplay();
  });
  wizardScheduleTime?.addEventListener('change', () => {
    updateWizardTimingDisplay();
  });

  // Set default timing for wizard to Today in 5 mins
  applyWizardTimingPreset('5m');

  // Close button for upload confirmation toast
  document.getElementById('btnCloseUploadToast')?.addEventListener('click', () => {
    document.getElementById('uploadSuccessToast')?.classList.add('hidden');
  });

  // Wizard Submit Handlers
  document.getElementById('btnScheduleBatchSubmit')?.addEventListener('click', () => submitWizardBatch(false));
  document.getElementById('btnStartBatchNowSubmit')?.addEventListener('click', () => submitWizardBatch(true));
}

function applyWizardTimingPreset(presetKey) {
  const now = new Date();
  let target = new Date();

  if (presetKey === '5m') {
    target = new Date(now.getTime() + 5 * 60 * 1000);
  } else if (presetKey === '15m') {
    target = new Date(now.getTime() + 15 * 60 * 1000);
  } else if (presetKey === '1h') {
    target = new Date(now.getTime() + 60 * 60 * 1000);
  } else if (presetKey === 'today-6pm') {
    target = new Date();
    target.setHours(18, 0, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target = new Date(now.getTime() + 60 * 60 * 1000);
    }
  } else if (presetKey === 'tomorrow-10am') {
    target.setDate(target.getDate() + 1);
    target.setHours(10, 0, 0, 0);
  } else if (presetKey === '2d') {
    target.setDate(target.getDate() + 2);
    target.setHours(10, 0, 0, 0);
  }

  const wizardScheduleTime = document.getElementById('wizardScheduleTime');
  if (wizardScheduleTime) {
    wizardScheduleTime.value = formatToLocalDateTimeString(target);
  }
  updateWizardTimingDisplay();
}

function updateWizardTimingDisplay() {
  const wizardScheduleTime = document.getElementById('wizardScheduleTime');
  const display = document.getElementById('wizardScheduledDisplay');
  if (!wizardScheduleTime || !display) return;

  const val = wizardScheduleTime.value;
  if (!val) {
    display.textContent = '⏰ Pick date & time';
    return;
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    display.textContent = '⏰ Invalid date';
  } else {
    const diffMs = d.getTime() - Date.now();
    const diffMins = Math.round(diffMs / 60000);
    let rel = '';
    if (diffMins <= 0) rel = 'Due now';
    else if (diffMins < 60) rel = `in ${diffMins} min${diffMins > 1 ? 's' : ''}`;
    else if (diffMins < 1440) rel = `in ~${Math.round(diffMins / 60)} hrs`;
    else rel = `in ~${Math.round(diffMins / 1440)} days`;
    display.textContent = `⏰ Starts ${rel} (${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
  }
}

function showUploadToast(total, valid, duplicates = 0, invalid = 0) {
  const toast = document.getElementById('uploadSuccessToast');
  const title = document.getElementById('uploadToastTitle');
  const desc = document.getElementById('uploadToastDesc');
  if (!toast) return;

  title.textContent = '🎉 CSV Uploaded Successfully!';
  desc.textContent = `Extracted ${total} contacts (${valid} valid, ${duplicates} duplicates, ${invalid} invalid).`;
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 5000);
}

function handleCSVFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target.result;
    const parsed = parseCSV(content);

    // Show Top Confirmation Banner with file name and contact count
    const banner = document.getElementById('csvSuccessBanner');
    const bannerFile = document.getElementById('csvAlertFilename');
    const bannerCount = document.getElementById('csvAlertCount');
    if (banner && bannerFile && bannerCount) {
      bannerFile.textContent = file.name;
      bannerCount.textContent = `${parsed.rows.length} contacts found & ready`;
      banner.classList.remove('hidden');
    }

    // Show Uploaded File Card in Step 1 so user clearly sees the file name and is never confused
    const fileCard = document.getElementById('uploadedFileCard');
    const dropzone = document.getElementById('dropzoneArea');
    const fileNameDisplay = document.getElementById('uploadedFileNameDisplay');
    const fileDetailsDisplay = document.getElementById('uploadedFileDetails');
    if (fileCard && dropzone && fileNameDisplay && fileDetailsDisplay) {
      fileNameDisplay.textContent = file.name;
      const sizeKb = (file.size / 1024).toFixed(1);
      fileDetailsDisplay.textContent = `${parsed.rows.length} contacts parsed • ${sizeKb} KB • CSV Document`;
      dropzone.classList.add('hidden');
      fileCard.classList.remove('hidden');
    }

    // Auto-fill campaign title from filename
    const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
    const titleInput = document.getElementById('wizardBatchTitle');
    if (titleInput && !titleInput.value) {
      titleInput.value = `${cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1)} Follow-up`;
    }

    handleParsedRows(parsed.headers, parsed.rows);
  };
  reader.readAsText(file);
}

function handleParsedRows(headers, rows) {
  wizardHeaders = headers;
  wizardRawRows = rows;

  const mappingCard = document.getElementById('mappingCard');
  mappingCard.classList.remove('hidden');

  // Populate column selectors
  const phoneSelect = document.getElementById('selectPhoneCol');
  const nameSelect = document.getElementById('selectNameCol');
  phoneSelect.innerHTML = '';
  nameSelect.innerHTML = '<option value="">-- Auto-generate names --</option>';

  headers.forEach((h) => {
    const optP = document.createElement('option');
    optP.value = h;
    optP.textContent = h;
    phoneSelect.appendChild(optP);

    const optN = document.createElement('option');
    optN.value = h;
    optN.textContent = h;
    nameSelect.appendChild(optN);
  });

  // Auto-detect best columns
  const detected = autoDetectColumns(headers);
  if (detected.phoneColumn) phoneSelect.value = detected.phoneColumn;
  if (detected.nameColumn) nameSelect.value = detected.nameColumn;

  // Populate dynamic variable pills in step 2
  populateVariablePills(headers);

  // Process rows
  reprocessWizardRecipients();

  // Show positive upload confirmation toast!
  showUploadToast(
    rows.length,
    wizardProcessedRecipients.length,
    wizardRawRows.length - wizardProcessedRecipients.length
  );
  SoundPlayer.playChime(0.6);
}

function populateVariablePills(headers) {
  const container = document.getElementById('variablePillsContainer');
  container.innerHTML = '';

  headers.forEach((h) => {
    const cleanVar = h.toLowerCase().trim();
    const pill = document.createElement('span');
    pill.className = 'pill-var';
    pill.textContent = `+ {{${cleanVar}}}`;
    pill.addEventListener('click', () => {
      insertVariableIntoMessage(`{{${cleanVar}}}`);
    });
    container.appendChild(pill);
  });
}

function insertVariableIntoMessage(varText) {
  const textarea = document.getElementById('wizardMessageBody');
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  const val = textarea.value;

  textarea.value = val.substring(0, start) + varText + val.substring(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + varText.length;
  updateLivePreview();
}

function reprocessWizardRecipients() {
  const phoneCol = document.getElementById('selectPhoneCol').value;
  const nameCol = document.getElementById('selectNameCol').value;
  const defaultCC = document.getElementById('selectDefaultCC').value || '91';

  const processed = processRecipientsList(wizardRawRows, {
    phoneColumn: phoneCol,
    nameColumn: nameCol
  }, defaultCC);

  wizardProcessedRecipients = processed.recipients.filter((r) => r.isValid && !r.isDuplicate);

  // Update summary badge counts
  document.getElementById('badgeValidCount').textContent = `${processed.validCount} Valid`;
  document.getElementById('badgeFormattedCount').textContent = `${wizardProcessedRecipients.length} Ready`;
  document.getElementById('badgeDuplicateCount').textContent = `${processed.duplicateCount} Duplicates`;
  document.getElementById('badgeInvalidCount').textContent = `${processed.invalidCount} Invalid`;

  // Render preview table of first 5 rows
  renderPreviewTable(processed.recipients.slice(0, 5));

  wizardSampleIndex = 0;
  updateLivePreview();
}

function renderPreviewTable(sampleRecipients) {
  const thead = document.getElementById('previewTableHead');
  const tbody = document.getElementById('previewTableBody');
  thead.innerHTML = '<th>Row</th><th>Name</th><th>Phone</th><th>Status</th>';
  tbody.innerHTML = '';

  sampleRecipients.forEach((r) => {
    const tr = document.createElement('tr');
    let statusBadge = '<span class="stat-badge stat-valid">Valid</span>';
    if (!r.isValid) statusBadge = `<span class="stat-badge stat-invalid">${escapeHtml(r.validationError || 'Invalid')}</span>`;
    else if (r.isDuplicate) statusBadge = '<span class="stat-badge stat-duplicate">Duplicate</span>';

    tr.innerHTML = `
      <td>#${r.rowIndex}</td>
      <td><strong>${escapeHtml(r.name)}</strong></td>
      <td>${escapeHtml(r.phone)}</td>
      <td>${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

function updateLivePreview() {
  const messageBody = document.getElementById('wizardMessageBody').value;
  const sampleText = document.getElementById('sampleIndexText');
  const previewName = document.getElementById('previewContactName');
  const previewPhone = document.getElementById('previewContactPhone');
  const bubbleText = document.getElementById('liveBubbleText');

  if (wizardProcessedRecipients.length === 0) {
    bubbleText.textContent = messageBody || 'Upload a CSV to see live preview with real recipient data.';
    return;
  }

  const recipient = wizardProcessedRecipients[wizardSampleIndex];
  if (!recipient) return;

  sampleText.textContent = `Previewing Recipient #${wizardSampleIndex + 1} of ${wizardProcessedRecipients.length}`;
  previewName.textContent = recipient.name;
  previewPhone.textContent = `+${recipient.phone}`;

  const rendered = renderTemplate(messageBody, recipient.customFields || { name: recipient.name, phone: recipient.phone });
  bubbleText.textContent = rendered || 'Type a message above to see it rendered here.';

  // Check pre-flight variable health
  const validation = validateBatchVariables(messageBody, wizardProcessedRecipients);
  const warnBanner = document.getElementById('variableWarningBanner');
  const warnText = document.getElementById('variableWarningText');
  const btnAutoAddFallback = document.getElementById('btnAutoAddFallback');

  if (!validation.isValid && validation.summaryMessage) {
    warnBanner.classList.remove('hidden');
    warnText.textContent = validation.summaryMessage;
    if (btnAutoAddFallback && validation.primaryMissingVar) {
      btnAutoAddFallback.style.display = 'inline-block';
      btnAutoAddFallback.textContent = `✨ Auto-Add Fallback: {{${validation.primaryMissingVar}|there}}`;
      btnAutoAddFallback.onclick = () => {
        const textarea = document.getElementById('wizardMessageBody');
        const target = new RegExp(`\\{\\{\\s*${validation.primaryMissingVar}\\s*\\}\\}`, 'g');
        textarea.value = textarea.value.replace(target, `{{${validation.primaryMissingVar}|there}}`);
        updateLivePreview();
      };
    } else if (btnAutoAddFallback) {
      btnAutoAddFallback.style.display = 'none';
    }
  } else {
    warnBanner.classList.add('hidden');
  }
}

async function submitWizardBatch(startImmediately = false) {
  try {
    if (wizardProcessedRecipients.length === 0) {
      alert('Please import at least one valid recipient first.');
      return;
    }

    const title = document.getElementById('wizardBatchTitle').value.trim();
    if (!title) {
      alert('Please enter a campaign title.');
      document.getElementById('wizardBatchTitle').focus();
      return;
    }

    const messageBody = document.getElementById('wizardMessageBody').value.trim();
    if (!messageBody) {
      alert('Please enter your follow-up message.');
      document.getElementById('wizardMessageBody').focus();
      return;
    }

    const scheduleInput = document.getElementById('wizardScheduleTime')?.value;
    let scheduledDate;
    if (startImmediately) {
      scheduledDate = new Date();
    } else if (scheduleInput) {
      const p = new Date(scheduleInput);
      scheduledDate = isNaN(p.getTime()) ? new Date(Date.now() + 5 * 60 * 1000) : p;
    } else {
      scheduledDate = new Date(Date.now() + 5 * 60 * 1000);
    }
    const scheduledAt = scheduledDate.toISOString();
    const pacingSeconds = document.getElementById('wizardEnablePacing')?.checked ? 10 : 0;

    // Pre-render messages for all recipients
    const renderedRecipients = renderBatchRecipients(messageBody, wizardProcessedRecipients);

    const newBatch = {
      title,
      type: 'batch',
      templateBody: messageBody,
      recipients: renderedRecipients,
      currentIndex: 0,
      scheduledAt,
      pacingSeconds,
      status: startImmediately ? BATCH_STATUS.IN_PROGRESS : BATCH_STATUS.SCHEDULED,
      ...(currentWizardSheetSync ? { sheetSync: currentWizardSheetSync } : {})
    };

    const saved = await StorageService.saveBatch(newBatch);
    currentWizardSheetSync = null;

    if (startImmediately) {
      // Open in Side Panel right now!
      chrome.runtime.sendMessage({ type: 'OPEN_WORKSPACE', batchId: saved.id });
    } else {
      // Schedule alarm
      chrome.runtime.sendMessage({
        type: 'SCHEDULE_BATCH',
        batchId: saved.id,
        scheduledAt: saved.scheduledAt
      });
      alert(`🎉 Batch "${title}" scheduled for ${new Date(scheduledAt).toLocaleString()}!`);
      switchTab('tab-batches');
    }
  } catch (err) {
    console.error('[PingLater Wizard] Failed to schedule batch:', err);
    alert('Failed to schedule batch: ' + err.message);
  }
}

// ==========================================
// TAB 3: QUICK 1-TO-1 FOLLOW-UP
// ==========================================

function setupQuickPingTab() {
  const singleTemplateSelect = document.getElementById('singleTemplateSelect');
  const singleMessage = document.getElementById('singleMessage');
  const singleScheduleTime = document.getElementById('singleScheduledTime');
  const singleScheduledDisplay = document.getElementById('singleScheduledDisplay');
  const quickToast = document.getElementById('quickToast');
  const quickToastTitle = document.getElementById('quickToastTitle');
  const quickToastMessage = document.getElementById('quickToastMessage');

  // Recurring Schedule Controls
  const toggleRecurring = document.getElementById('toggleRecurringFollowup');
  const recurringOptionsContainer = document.getElementById('recurringOptionsContainer');
  const recurringControlCard = document.getElementById('recurringControlCard');
  const recurringTimeOfDay = document.getElementById('recurringTimeOfDay');
  const recurringStartDate = document.getElementById('recurringStartDate');
  const recurringEndDate = document.getElementById('recurringEndDate');
  const recurringLiveSummary = document.getElementById('recurringLiveSummary');
  const btnSaveSingleFollowup = document.getElementById('btnSaveSingleFollowup');

  let selectedFrequency = 'daily';

  // Default dates: Start = Today, End = Today + 7 days
  const todayStr = new Date().toISOString().slice(0, 10);
  const next7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (recurringStartDate && !recurringStartDate.value) recurringStartDate.value = todayStr;
  if (recurringEndDate && !recurringEndDate.value) recurringEndDate.value = next7Days;

  function updateRecurringSummary() {
    if (!toggleRecurring || !toggleRecurring.checked) return;
    const config = {
      frequency: selectedFrequency,
      timeOfDay: recurringTimeOfDay?.value || '09:00',
      startDate: recurringStartDate?.value || todayStr,
      endDate: recurringEndDate?.value || next7Days
    };
    const summaryText = formatRecurrenceSummary(config);
    if (recurringLiveSummary) {
      recurringLiveSummary.innerHTML = `Will remind you <strong>${summaryText}</strong>`;
    }
    const cycles = calculateTotalCycles(config.frequency, config.startDate, config.endDate);
    if (btnSaveSingleFollowup) {
      btnSaveSingleFollowup.textContent = `🔁 Schedule Recurring Follow-up (${cycles} Messages)`;
    }
  }

  toggleRecurring?.addEventListener('change', () => {
    if (toggleRecurring.checked) {
      recurringOptionsContainer?.classList.remove('hidden');
      recurringControlCard?.classList.add('active');
      updateRecurringSummary();
    } else {
      recurringOptionsContainer?.classList.add('hidden');
      recurringControlCard?.classList.remove('active');
      if (btnSaveSingleFollowup) {
        btnSaveSingleFollowup.textContent = '⏰ Schedule 1-on-1 Follow-up';
      }
    }
  });

  // Frequency pills
  const freqPills = document.querySelectorAll('.btn-freq-pill');
  freqPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      freqPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      selectedFrequency = pill.getAttribute('data-freq') || 'daily';
      updateRecurringSummary();
    });
  });

  // Range preset buttons
  const rangePresets = document.querySelectorAll('.btn-range-preset');
  rangePresets.forEach((btn) => {
    btn.addEventListener('click', () => {
      rangePresets.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const range = btn.getAttribute('data-range');
      const startD = recurringStartDate?.value ? new Date(recurringStartDate.value) : new Date();
      let days = 7;
      if (range === '14d') days = 14;
      if (range === '30d') days = 30;
      const targetEnd = new Date(startD.getTime() + days * 24 * 60 * 60 * 1000);
      if (recurringEndDate) {
        recurringEndDate.value = targetEnd.toISOString().slice(0, 10);
      }
      updateRecurringSummary();
    });
  });

  recurringTimeOfDay?.addEventListener('input', updateRecurringSummary);
  recurringStartDate?.addEventListener('input', updateRecurringSummary);
  recurringEndDate?.addEventListener('input', updateRecurringSummary);

  // Set default timing to Today in 5 mins (not 10-15 mins ahead!)
  applyTimingPreset('5m');

  // Handle Preset Pills
  const presetButtons = document.querySelectorAll('#tab-quick-ping .btn-timing-preset');
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      presetButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const presetKey = btn.getAttribute('data-preset');
      applyTimingPreset(presetKey);
    });
  });

  // Handle Sync Button for Quick 1-to-1
  document.getElementById('btnSyncQuickTime')?.addEventListener('click', () => {
    presetButtons.forEach((b) => b.classList.remove('active'));
    document.querySelector('#tab-quick-ping [data-preset="5m"]')?.classList.add('active');
    applyTimingPreset('5m');
  });

  // When user manually picks date/time in the input
  singleScheduleTime?.addEventListener('input', () => {
    presetButtons.forEach((b) => b.classList.remove('active'));
    updateTimingDisplayFromInput();
  });
  singleScheduleTime?.addEventListener('change', () => {
    updateTimingDisplayFromInput();
  });

  function applyTimingPreset(presetKey) {
    const now = new Date();
    let target = new Date();

    if (presetKey === '5m') {
      target = new Date(now.getTime() + 5 * 60 * 1000);
    } else if (presetKey === '15m') {
      target = new Date(now.getTime() + 15 * 60 * 1000);
    } else if (presetKey === '1h') {
      target = new Date(now.getTime() + 60 * 60 * 1000);
    } else if (presetKey === 'today-6pm') {
      target = new Date();
      target.setHours(18, 0, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target = new Date(now.getTime() + 60 * 60 * 1000);
      }
    } else if (presetKey === 'tomorrow-10am') {
      target.setDate(target.getDate() + 1);
      target.setHours(10, 0, 0, 0);
    } else if (presetKey === '2d') {
      target.setDate(target.getDate() + 2);
      target.setHours(10, 0, 0, 0);
    }

    if (singleScheduleTime) {
      singleScheduleTime.value = formatToLocalDateTimeString(target);
    }
    updateTimingDisplayFromInput();
  }

  function updateTimingDisplayFromInput() {
    if (!singleScheduleTime || !singleScheduledDisplay) return;
    const val = singleScheduleTime.value;
    if (!val) {
      singleScheduledDisplay.textContent = '⏰ Pick date & time';
      return;
    }
    const d = new Date(val);
    if (isNaN(d.getTime())) {
      singleScheduledDisplay.textContent = '⏰ Invalid date';
    } else {
      const diffMs = d.getTime() - Date.now();
      const diffMins = Math.round(diffMs / 60000);
      let rel = '';
      if (diffMins <= 0) rel = 'Due now';
      else if (diffMins < 60) rel = `in ${diffMins} min${diffMins > 1 ? 's' : ''}`;
      else if (diffMins < 1440) rel = `in ~${Math.round(diffMins / 60)} hrs`;
      else rel = `in ~${Math.round(diffMins / 1440)} days`;
      singleScheduledDisplay.textContent = `⏰ Starts ${rel} (${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
    }
  }

  // Handle Template Dropdown selection
  singleTemplateSelect?.addEventListener('change', (e) => {
    const tplId = e.target.value;
    if (!tplId) return;
    const tpl = currentTemplates.find((t) => t.id === tplId);
    if (tpl) {
      singleMessage.value = tpl.body;
    }
  });

  // Save current text as new reusable template
  document.getElementById('btnSaveCurrentAsTemplate')?.addEventListener('click', async () => {
    const text = singleMessage.value.trim();
    if (!text) {
      alert('Please write a message first before saving as a template.');
      singleMessage.focus();
      return;
    }
    const title = prompt('Enter a name for this template:', 'Custom Follow-up');
    if (!title || !title.trim()) return;

    const vars = extractVariables(text);
    await StorageService.saveTemplate({
      title: title.trim(),
      category: 'General',
      body: text,
      variables: vars
    });

    await refreshTemplatesList();
    alert(`🎉 Template "${title}" saved and added to your templates!`);
  });

  // Action: Schedule 1-on-1 Follow-up
  document.getElementById('btnSaveSingleFollowup')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const name = document.getElementById('singleName').value.trim();
      const phoneRaw = document.getElementById('singlePhone').value.trim();
      const message = document.getElementById('singleMessage').value.trim();

      if (!name) {
        alert('Please enter a Contact Name.');
        document.getElementById('singleName').focus();
        return;
      }
      if (!phoneRaw) {
        alert('Please enter a WhatsApp Phone Number.');
        document.getElementById('singlePhone').focus();
        return;
      }
      if (!message) {
        alert('Please enter your follow-up message.');
        document.getElementById('singleMessage').focus();
        return;
      }

      const defaultCC = currentSettings ? currentSettings.defaultCountryCode : '91';
      const norm = normalizePhoneNumber(phoneRaw, defaultCC);
      if (!norm.isValid) {
        alert(`Invalid phone number: ${norm.error || 'Please enter at least 10 digits'}`);
        document.getElementById('singlePhone').focus();
        return;
      }

      const isRecurring = toggleRecurring && toggleRecurring.checked;
      let scheduledAt;
      let recurringConfig = null;
      let batchTitle = `Follow-up with ${name}`;

      if (isRecurring) {
        const timeOfDay = recurringTimeOfDay?.value || '09:00';
        const startDate = recurringStartDate?.value;
        const endDate = recurringEndDate?.value;

        if (!startDate || !endDate) {
          alert('Please enter both a Start Date and an End Date for the recurring schedule.');
          return;
        }

        if (new Date(startDate) > new Date(endDate)) {
          alert('Start Date cannot be after End Date.');
          return;
        }

        const totalCycles = calculateTotalCycles(selectedFrequency, startDate, endDate);
        recurringConfig = {
          frequency: selectedFrequency,
          timeOfDay,
          startDate,
          endDate,
          totalCycles,
          currentCycle: 1,
          history: []
        };

        const firstOccurrence = calculateNextRecurringDate(recurringConfig, new Date());
        if (!firstOccurrence) {
          alert('The chosen recurring schedule date range has already ended. Please select future dates.');
          return;
        }
        scheduledAt = firstOccurrence.toISOString();

        const freqLabel = selectedFrequency === 'weekly' ? 'Weekly' : selectedFrequency === 'weekdays' ? 'Weekday' : 'Daily';
        batchTitle = `🔁 ${freqLabel} Follow-up with ${name}`;
      } else {
        // Safe one-time date parsing from input
        let scheduledDate;
        const val = singleScheduleTime ? singleScheduleTime.value : null;
        if (val) {
          const p = new Date(val);
          scheduledDate = isNaN(p.getTime()) ? new Date(Date.now() + 15 * 60 * 1000) : p;
        } else {
          scheduledDate = new Date(Date.now() + 15 * 60 * 1000);
        }
        scheduledAt = scheduledDate.toISOString();
      }

      const rendered = renderTemplate(message, { name, phone: norm.normalized });

      const batch = {
        title: batchTitle,
        type: 'single',
        isRecurring: !!isRecurring,
        recurringConfig,
        templateBody: message,
        recipients: [{
          id: `rec_single_${Date.now()}`,
          name,
          phone: norm.normalized,
          renderedMessage: rendered,
          status: RECIPIENT_STATUS.PENDING,
          customFields: { name, phone: norm.normalized }
        }],
        currentIndex: 0,
        scheduledAt,
        pacingSeconds: 0,
        status: BATCH_STATUS.SCHEDULED
      };

      const saved = await StorageService.saveBatch(batch);

      // Register Chrome alarm via background
      chrome.runtime.sendMessage({
        type: 'SCHEDULE_BATCH',
        batchId: saved.id,
        scheduledAt
      });

      // Notify Side Panel so it updates its queue in real-time
      chrome.runtime.sendMessage({
        type: 'LOAD_BATCH_IN_SIDEPANEL',
        batchId: saved.id
      }).catch(() => {});

      // Show inline success toast
      if (quickToast) {
        if (isRecurring) {
          quickToastTitle.textContent = `🔁 Recurring Follow-up Scheduled!`;
          quickToastMessage.textContent = `${recurringConfig.frequency.toUpperCase()} at ${recurringConfig.timeOfDay} starting ${new Date(scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} (${recurringConfig.totalCycles} follow-ups total).`;
        } else {
          quickToastTitle.textContent = `Scheduled with ${name}!`;
          quickToastMessage.textContent = `Reminder set for ${new Date(scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`;
        }
        quickToast.classList.remove('hidden');
      }

      // Refresh batches table and switch to batches view after short delay
      await refreshBatchesList();
      setTimeout(() => {
        if (quickToast) quickToast.classList.add('hidden');
        switchTab('tab-batches');
      }, 1000);

    } catch (err) {
      console.error('[PingLater] Error scheduling 1-on-1:', err);
      alert('Error scheduling follow-up: ' + err.message);
    }
  });

  // Action: Open in WhatsApp Now
  document.getElementById('btnSendSingleNow')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const name = document.getElementById('singleName').value.trim();
      const phoneRaw = document.getElementById('singlePhone').value.trim();
      const message = document.getElementById('singleMessage').value.trim();

      if (!phoneRaw) {
        alert('Please enter a WhatsApp Phone Number to open the chat.');
        document.getElementById('singlePhone').focus();
        return;
      }

      const defaultCC = currentSettings ? currentSettings.defaultCountryCode : '91';
      const norm = normalizePhoneNumber(phoneRaw, defaultCC);
      if (!norm.isValid) {
        alert(`Invalid phone number: ${norm.error || 'Please enter at least 10 digits'}`);
        document.getElementById('singlePhone').focus();
        return;
      }

      const rendered = renderTemplate(message || 'Hi', { name: name || 'there', phone: norm.normalized });
      await WhatsAppOrchestrator.loadContact(norm.normalized, rendered);
    } catch (err) {
      console.error('[PingLater] Error opening WhatsApp now:', err);
      alert('Could not open WhatsApp: ' + err.message);
    }
  });
}

function formatToLocalDateTimeString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// ==========================================
// MODAL: EDIT SCHEDULE & BATCH
// ==========================================

let editingBatchId = null;

function setupEditScheduleModal() {
  const modal = document.getElementById('editScheduleModal');
  const closeBtn = document.getElementById('btnCloseEditScheduleModal');
  const cancelBtn = document.getElementById('btnCancelEditScheduleModal');
  const saveBtn = document.getElementById('btnSaveEditScheduleModal');
  const timeInput = document.getElementById('editScheduleTimeInput');
  const displaySpan = document.getElementById('editScheduleTimeDisplay');

  // Close handlers
  closeBtn?.addEventListener('click', closeEditScheduleModal);
  cancelBtn?.addEventListener('click', closeEditScheduleModal);

  // Preset pills
  const editPresets = modal?.querySelectorAll('.btn-timing-preset[data-edit-preset]');
  editPresets?.forEach((btn) => {
    btn.addEventListener('click', () => {
      editPresets.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const preset = btn.getAttribute('data-edit-preset');
      applyEditTimingPreset(preset);
    });
  });

  // Time input manual change
  timeInput?.addEventListener('input', () => {
    editPresets?.forEach((b) => b.classList.remove('active'));
    updateEditTimingDisplay();
  });
  timeInput?.addEventListener('change', updateEditTimingDisplay);

  function applyEditTimingPreset(presetKey) {
    const now = new Date();
    let target = new Date();
    if (presetKey === '15m') {
      target = new Date(now.getTime() + 15 * 60 * 1000);
    } else if (presetKey === '1h') {
      target = new Date(now.getTime() + 60 * 60 * 1000);
    } else if (presetKey === 'tomorrow-10am') {
      target.setDate(target.getDate() + 1);
      target.setHours(10, 0, 0, 0);
    } else if (presetKey === '2d') {
      target.setDate(target.getDate() + 2);
      target.setHours(10, 0, 0, 0);
    }

    if (timeInput) {
      timeInput.value = formatToLocalDateTimeString(target);
    }
    updateEditTimingDisplay();
  }

  function updateEditTimingDisplay() {
    if (!timeInput || !displaySpan) return;
    const val = timeInput.value;
    if (!val) {
      displaySpan.textContent = '⏰ Pick date & time';
      return;
    }
    const d = new Date(val);
    if (isNaN(d.getTime())) {
      displaySpan.textContent = '⏰ Invalid date';
    } else {
      displaySpan.textContent = `⏰ ${d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
    }
  }

  // Save handler
  saveBtn?.addEventListener('click', async () => {
    if (!editingBatchId) return;
    const batch = currentBatches.find((b) => b.id === editingBatchId);
    if (!batch) return;

    const titleInput = document.getElementById('editBatchTitleInput');
    const msgInput = document.getElementById('editBatchMessageInput');
    const newTitle = titleInput ? titleInput.value.trim() : '';
    const newMsg = msgInput ? msgInput.value.trim() : '';
    const timeVal = timeInput ? timeInput.value : '';

    if (!newTitle) {
      alert('Please enter a title for the batch.');
      titleInput?.focus();
      return;
    }

    if (!timeVal) {
      alert('Please pick a scheduled date & time.');
      timeInput?.focus();
      return;
    }

    const scheduledDate = new Date(timeVal);
    if (isNaN(scheduledDate.getTime())) {
      alert('Please select a valid date & time.');
      timeInput?.focus();
      return;
    }

    const scheduledAt = scheduledDate.toISOString();

    // Update batch properties
    batch.title = newTitle;
    batch.scheduledAt = scheduledAt;
    if (batch.status === BATCH_STATUS.OVERDUE || batch.status === BATCH_STATUS.SCHEDULED) {
      batch.status = BATCH_STATUS.SCHEDULED;
    }

    if (newMsg && newMsg !== batch.templateBody) {
      batch.templateBody = newMsg;
      if (batch.recipients && batch.recipients.length === 1) {
        batch.recipients[0].renderedMessage = newMsg;
      }
    }

    await StorageService.saveBatch(batch);

    // Update alarm
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'CANCEL_BATCH_ALARM',
        batchId: batch.id
      });
      chrome.runtime.sendMessage({
        type: 'SCHEDULE_BATCH',
        batchId: batch.id,
        scheduledAt
      });
    }

    closeEditScheduleModal();
    await refreshBatchesList();
    alert(`✅ Schedule updated! Follow-up set for ${scheduledDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`);
  });
}

function openEditScheduleModal(batch) {
  if (!batch) return;
  editingBatchId = batch.id;

  const modal = document.getElementById('editScheduleModal');
  const titleInput = document.getElementById('editBatchTitleInput');
  const timeInput = document.getElementById('editScheduleTimeInput');
  const msgInput = document.getElementById('editBatchMessageInput');
  const displaySpan = document.getElementById('editScheduleTimeDisplay');

  if (titleInput) titleInput.value = batch.title || '';
  if (msgInput) {
    msgInput.value = batch.templateBody || (batch.recipients && batch.recipients[0] ? batch.recipients[0].renderedMessage : '') || '';
  }

  if (batch.scheduledAt && timeInput) {
    const d = new Date(batch.scheduledAt);
    timeInput.value = formatToLocalDateTimeString(d);
    if (displaySpan) {
      displaySpan.textContent = `⏰ ${d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
    }
  }

  modal?.classList.remove('hidden');
}

function closeEditScheduleModal() {
  editingBatchId = null;
  const modal = document.getElementById('editScheduleModal');
  modal?.classList.add('hidden');
}

// ==========================================
// MODAL: SKIPPED RECIPIENTS BREAKDOWN & EXPORT
// ==========================================

let currentSkippedBatch = null;

function setupSkippedModal() {
  const modal = document.getElementById('skippedRecipientsModal');
  document.getElementById('btnCloseSkippedModal')?.addEventListener('click', () => {
    modal?.classList.add('hidden');
  });
  document.getElementById('btnCloseSkippedModalBtn')?.addEventListener('click', () => {
    modal?.classList.add('hidden');
  });

  document.getElementById('btnExportSkippedCSV')?.addEventListener('click', () => {
    if (!currentSkippedBatch) return;
    const skipped = (currentSkippedBatch.recipients || []).filter((r) => r.status === RECIPIENT_STATUS.SKIPPED);
    if (skipped.length === 0) {
      alert('No skipped contacts to export in this batch.');
      return;
    }

    const headers = ['#', 'Name', 'Phone', 'Status', 'Message'];
    const rows = skipped.map((r, i) => [
      i + 1,
      `"${(r.name || '').replace(/"/g, '""')}"`,
      `"${r.phone}"`,
      `"Skipped"`,
      `"${(r.renderedMessage || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${currentSkippedBatch.title.replace(/\s+/g, '_')}_Skipped_Contacts.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}

function openSkippedRecipientsModal(batch) {
  if (!batch) return;
  currentSkippedBatch = batch;

  const modal = document.getElementById('skippedRecipientsModal');
  const title = document.getElementById('skippedModalTitle');
  const tbody = document.getElementById('skippedTableBody');
  if (!modal || !tbody) return;

  const skipped = (batch.recipients || []).filter((r) => r.status === RECIPIENT_STATUS.SKIPPED);
  title.textContent = `⚠️ Skipped Contacts in "${batch.title}" (${skipped.length})`;

  tbody.innerHTML = '';
  if (skipped.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #64748b;">No skipped contacts found in this batch.</td></tr>';
  } else {
    skipped.forEach((r, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0;">#${idx + 1}</td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${escapeHtml(r.name || 'Unnamed')}</td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0;">+${escapeHtml(r.phone)}</td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #e2e8f0;"><span class="stat-badge stat-invalid">Skipped (Not on WhatsApp / Passed)</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  modal.classList.remove('hidden');
}

// ==========================================
// TAB 4: MESSAGE TEMPLATES MANAGER
// ==========================================

let templateFilterCat = 'all';

function setupTemplatesTab() {
  const catPills = document.querySelectorAll('#templateCategoryPills .pill');
  catPills.forEach((p) => {
    p.addEventListener('click', () => {
      catPills.forEach((x) => x.classList.remove('active'));
      p.classList.add('active');
      templateFilterCat = p.getAttribute('data-cat') || 'all';
      renderTemplatesList();
    });
  });

  document.getElementById('btnOpenNewTemplateModal')?.addEventListener('click', () => {
    openTemplateModal();
  });

  document.getElementById('btnCloseTemplateModal')?.addEventListener('click', closeTemplateModal);
  document.getElementById('btnCancelTemplateModal')?.addEventListener('click', closeTemplateModal);

  document.getElementById('btnSaveTemplateModal')?.addEventListener('click', async () => {
    const id = document.getElementById('editTemplateId').value;
    const title = document.getElementById('templateTitleInput').value.trim();
    const category = document.getElementById('templateCategoryInput').value;
    const shortcutRaw = document.getElementById('templateShortcutInput')?.value.trim() || '';
    const shortcut = shortcutRaw.replace(/^\/+/, '').toLowerCase();
    const body = document.getElementById('templateBodyInput').value.trim();

    if (!title || !body) {
      alert('Please enter both Template Name and Message Body.');
      return;
    }

    const vars = extractVariables(body);
    await StorageService.saveTemplate({
      id: id || undefined,
      title,
      category,
      shortcut: shortcut || undefined,
      body,
      variables: vars
    });

    closeTemplateModal();
    refreshTemplatesList();
  });

  // Modal variable pill inserters
  document.querySelectorAll('.modal-pills-row .pill-var').forEach((p) => {
    p.addEventListener('click', () => {
      const v = p.getAttribute('data-tpl-var');
      const textarea = document.getElementById('templateBodyInput');
      const start = textarea.selectionStart || 0;
      textarea.value = textarea.value.substring(0, start) + `{{${v}}}` + textarea.value.substring(textarea.selectionEnd);
      textarea.focus();
    });
  });
}

async function refreshTemplatesList() {
  currentTemplates = await StorageService.getTemplates();
  renderTemplatesList();
  populateTemplateDropdowns();
}

function renderTemplatesList() {
  const container = document.getElementById('templatesListContainer');
  container.innerHTML = '';

  const filtered = currentTemplates.filter((t) => {
    if (templateFilterCat === 'all') return true;
    return t.category === templateFilterCat;
  });

  filtered.forEach((tpl) => {
    const card = document.createElement('div');
    card.className = 'template-card';
    const shortcutBadge = tpl.shortcut ? `<span class="badge-shortcut" title="In-chat shortcut">/${escapeHtml(tpl.shortcut)}</span>` : '';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <h4 style="margin:0; font-size:15px; font-weight:700;">${escapeHtml(tpl.title)}</h4>
        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
          ${shortcutBadge}
          <span class="badge badge-scheduled">${escapeHtml(tpl.category || 'General')}</span>
        </div>
      </div>
      <div class="tpl-bubble">${escapeHtml(tpl.body)}</div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:auto;">
        <button class="btn btn-outline btn-sm btn-edit-tpl">✏️ Edit</button>
        <button class="btn btn-danger btn-sm btn-del-tpl">🗑️ Delete</button>
      </div>
    `;

    card.querySelector('.btn-edit-tpl').addEventListener('click', () => openTemplateModal(tpl));
    card.querySelector('.btn-del-tpl').addEventListener('click', async () => {
      if (confirm(`Delete template "${tpl.title}"?`)) {
        await StorageService.deleteTemplate(tpl.id);
        refreshTemplatesList();
      }
    });

    container.appendChild(card);
  });
}

function populateTemplateDropdowns() {
  const wizardSelect = document.getElementById('selectTemplateInWizard');
  const singleSelect = document.getElementById('singleTemplateSelect');

  function buildGroupedOptions(defaultLabel) {
    const profTemplates = currentTemplates.filter((t) => t.category === 'Professional');
    const casualTemplates = currentTemplates.filter((t) => t.category === 'Casual');
    const otherTemplates = currentTemplates.filter((t) => t.category !== 'Professional' && t.category !== 'Casual');

    let html = `<option value="">-- ${defaultLabel} --</option>`;

    if (profTemplates.length > 0) {
      html += '<optgroup label="💼 Professional Follow-ups">';
      profTemplates.forEach((t) => {
        html += `<option value="${t.id}">${escapeHtml(t.title)}</option>`;
      });
      html += '</optgroup>';
    }

    if (casualTemplates.length > 0) {
      html += '<optgroup label="💬 Casual & Friendly Check-ins">';
      casualTemplates.forEach((t) => {
        html += `<option value="${t.id}">${escapeHtml(t.title)}</option>`;
      });
      html += '</optgroup>';
    }

    if (otherTemplates.length > 0) {
      html += '<optgroup label="📁 Custom & Saved Templates">';
      otherTemplates.forEach((t) => {
        html += `<option value="${t.id}">${escapeHtml(t.title)}</option>`;
      });
      html += '</optgroup>';
    }

    return html;
  }

  if (wizardSelect) {
    wizardSelect.innerHTML = buildGroupedOptions('Write Custom Message');
  }

  if (singleSelect) {
    singleSelect.innerHTML = buildGroupedOptions('Custom Message (Type below)');
  }
}

function openTemplateModal(tpl = null) {
  const modal = document.getElementById('templateModal');
  const titleInput = document.getElementById('templateTitleInput');
  const catInput = document.getElementById('templateCategoryInput');
  const bodyInput = document.getElementById('templateBodyInput');
  const shortcutInput = document.getElementById('templateShortcutInput');
  const idInput = document.getElementById('editTemplateId');
  const modalHeader = document.getElementById('templateModalTitle');

  if (tpl) {
    modalHeader.textContent = 'Edit Message Template';
    idInput.value = tpl.id;
    titleInput.value = tpl.title;
    catInput.value = tpl.category || 'General';
    bodyInput.value = tpl.body;
    if (shortcutInput) shortcutInput.value = tpl.shortcut || '';
  } else {
    modalHeader.textContent = 'Create Message Template';
    idInput.value = '';
    titleInput.value = '';
    catInput.value = 'General';
    bodyInput.value = '';
    if (shortcutInput) shortcutInput.value = '';
  }

  modal.classList.remove('hidden');
}

function closeTemplateModal() {
  document.getElementById('templateModal').classList.add('hidden');
}

// ==========================================
// TAB: "AWAITING REPLY" SMART SNOOZE (FEATURE 2)
// ==========================================

let currentSnoozes = [];
let currentSnoozeFilter = 'all';

function setupSnoozeTab() {
  // Filter pills
  const pills = document.querySelectorAll('#snoozeFilterPills .pill');
  pills.forEach((p) => {
    p.addEventListener('click', () => {
      pills.forEach((x) => x.classList.remove('active'));
      p.classList.add('active');
      currentSnoozeFilter = p.dataset.filter || 'all';
      renderSnoozeCards();
    });
  });

  // Modal open / close
  document.getElementById('btnOpenNewSnoozeModal')?.addEventListener('click', () => {
    document.getElementById('snoozeContactName').value = '';
    document.getElementById('snoozePhone').value = '';
    document.getElementById('snoozeNote').value = '';
    document.getElementById('snoozeHours').value = '48';
    document.getElementById('newSnoozeModal')?.classList.remove('hidden');
  });

  document.getElementById('btnCloseNewSnoozeModal')?.addEventListener('click', () => {
    document.getElementById('newSnoozeModal')?.classList.add('hidden');
  });

  document.getElementById('btnCancelNewSnoozeModal')?.addEventListener('click', () => {
    document.getElementById('newSnoozeModal')?.classList.add('hidden');
  });

  // Save new snooze
  document.getElementById('btnSaveNewSnoozeModal')?.addEventListener('click', async () => {
    const name = document.getElementById('snoozeContactName').value.trim();
    const rawPhone = document.getElementById('snoozePhone').value.trim();
    const note = document.getElementById('snoozeNote').value.trim();
    const hours = parseFloat(document.getElementById('snoozeHours').value) || 48;

    if (!name && !rawPhone) {
      alert('Please enter at least a contact name or phone number.');
      return;
    }

    const cleanPhone = rawPhone.replace(/\D/g, '');
    const now = new Date();
    const dueAt = new Date(now.getTime() + hours * 3600000).toISOString();

    await StorageService.saveSnooze({
      contactName: name || `+${cleanPhone}`,
      phone: cleanPhone,
      cleanIdentifier: cleanPhone || name.toLowerCase(),
      snoozedAt: now.toISOString(),
      dueAt,
      durationHours: hours,
      lastMessageSnippet: note,
      status: SNOOZE_STATUS.AWAITING
    });

    document.getElementById('newSnoozeModal')?.classList.add('hidden');
    await refreshSnoozeView();
  });
}

async function refreshSnoozeView() {
  currentSnoozes = await StorageService.getSnoozes();
  const now = Date.now();

  let awaitingCount = 0;
  let dueCount = 0;
  let repliedCount = 0;

  currentSnoozes.forEach((s) => {
    if (s.status === SNOOZE_STATUS.REPLIED) {
      repliedCount++;
    } else if (s.status === SNOOZE_STATUS.AWAITING) {
      if (new Date(s.dueAt).getTime() <= now) {
        dueCount++;
      } else {
        awaitingCount++;
      }
    } else if (s.status === SNOOZE_STATUS.DUE) {
      dueCount++;
    }
  });

  // Update KPI counters
  const elAwaiting = document.getElementById('statAwaitingCount');
  if (elAwaiting) elAwaiting.textContent = String(awaitingCount);

  const elDue = document.getElementById('statDueCount');
  if (elDue) elDue.textContent = String(dueCount);

  const elReplied = document.getElementById('statRepliedCount');
  if (elReplied) elReplied.textContent = String(repliedCount);

  // Update nav badge
  const navBadge = document.getElementById('navSnoozeBadge');
  if (navBadge) {
    const totalActive = awaitingCount + dueCount;
    if (totalActive > 0) {
      navBadge.textContent = String(totalActive);
      navBadge.classList.remove('hidden');
    } else {
      navBadge.classList.add('hidden');
    }
  }

  renderSnoozeCards();
}

function formatDashboardSnoozeRemaining(dueAtIso) {
  const diffMs = new Date(dueAtIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Overdue';
  const totalSecs = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function calculateDashboardSnoozeProgress(s) {
  if (!s || !s.snoozedAt || !s.dueAt) return 0;
  const start = new Date(s.snoozedAt).getTime();
  const end = new Date(s.dueAt).getTime();
  const now = Date.now();
  const total = end - start;
  if (total <= 0) return 100;
  const elapsed = now - start;
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
}

function renderSnoozeCards() {
  const container = document.getElementById('snoozeCardsContainer');
  if (!container) return;

  const now = Date.now();

  let filtered = currentSnoozes;
  if (currentSnoozeFilter === 'awaiting') {
    filtered = currentSnoozes.filter((s) => s.status === SNOOZE_STATUS.AWAITING && new Date(s.dueAt).getTime() > now);
  } else if (currentSnoozeFilter === 'due') {
    filtered = currentSnoozes.filter((s) => s.status === SNOOZE_STATUS.DUE || (s.status === SNOOZE_STATUS.AWAITING && new Date(s.dueAt).getTime() <= now));
  } else if (currentSnoozeFilter === 'replied') {
    filtered = currentSnoozes.filter((s) => s.status === SNOOZE_STATUS.REPLIED);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; background: #FFFFFF; border: 1px dashed #CBD5E1; border-radius: 12px;">
        <div style="font-size: 36px; margin-bottom: 8px;">💤</div>
        <h4 style="font-size: 16px; font-weight: 700; color: #0F172A; margin: 0 0 6px 0;">No snoozed contacts in this view</h4>
        <p style="font-size: 13px; color: #64748B; margin: 0 0 16px 0;">Use the "+ Track New Contact" button or click "Snooze if no reply" directly in WhatsApp Web.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  filtered.forEach((s) => {
    const card = document.createElement('div');
    const isDue = s.status === SNOOZE_STATUS.DUE || (s.status === SNOOZE_STATUS.AWAITING && new Date(s.dueAt).getTime() <= now);
    const isReplied = s.status === SNOOZE_STATUS.REPLIED;
    const cardClass = isReplied ? 'replied' : isDue ? 'due' : 'awaiting';
    const progressPct = calculateDashboardSnoozeProgress(s);

    card.className = `snooze-card ${cardClass}`;

    let badgeHtml = '';
    if (isReplied) {
      badgeHtml = `<span class="badge-snooze-replied">🎉 Replied</span>`;
    } else if (isDue) {
      badgeHtml = `<span class="badge-snooze-due">⏰ Overdue 0s</span>`;
    } else {
      badgeHtml = `<span class="badge-snooze-awaiting snooze-live-ticker" data-due="${s.dueAt}" data-id="${s.id}">⏳ ${formatDashboardSnoozeRemaining(s.dueAt)}</span>`;
    }

    const snoozedDateStr = new Date(s.snoozedAt || s.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const dueDateStr = new Date(s.dueAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
      <div class="snooze-card-top">
        <div>
          <h4 class="snooze-card-name">${escapeHtml(s.contactName || 'Contact')}</h4>
          <div class="snooze-card-phone">${s.phone ? `+${escapeHtml(s.phone)}` : 'WhatsApp Contact'}</div>
        </div>
        ${badgeHtml}
      </div>

      <div class="snooze-progress-wrap" title="${progressPct}% deadline elapsed">
        <div class="snooze-progress-fill" style="width: ${progressPct}%;"></div>
      </div>

      <div class="snooze-card-meta">
        <div><span class="meta-label">Snoozed:</span> ${snoozedDateStr}</div>
        <div><span class="meta-label">${isReplied ? 'Replied at:' : 'Deadline:'}</span> ${isReplied && s.repliedAt ? new Date(s.repliedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : dueDateStr}</div>
        ${s.lastMessageSnippet ? `<div style="margin-top: 4px; font-style: italic; color: #475569;">"${escapeHtml(s.lastMessageSnippet.slice(0, 100))}"</div>` : ''}
      </div>

      <div class="snooze-card-actions">
        ${s.phone ? `<button type="button" class="btn btn-primary btn-sm btn-snooze-chat">💬 WhatsApp</button>` : '<div></div>'}
        <div style="display: flex; gap: 6px;">
          ${!isReplied ? `<button type="button" class="btn btn-outline btn-sm btn-snooze-mark-reply">✓ Mark Replied</button>` : ''}
          <button type="button" class="btn btn-neutral btn-sm btn-snooze-delete" title="Delete snooze">🗑️</button>
        </div>
      </div>
    `;

    // WhatsApp button
    card.querySelector('.btn-snooze-chat')?.addEventListener('click', () => {
      const cleanPhone = String(s.phone).replace(/\D/g, '');
      const url = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
      window.open(url, '_blank');
    });

    // Mark Replied
    card.querySelector('.btn-snooze-mark-reply')?.addEventListener('click', async () => {
      await StorageService.updateSnooze(s.id, {
        status: SNOOZE_STATUS.REPLIED,
        repliedAt: new Date().toISOString()
      });
      await refreshSnoozeView();
    });

    // Delete
    card.querySelector('.btn-snooze-delete')?.addEventListener('click', async () => {
      if (confirm(`Remove tracking for ${s.contactName || 'this contact'}?`)) {
        await StorageService.deleteSnooze(s.id);
        await refreshSnoozeView();
      }
    });

    container.appendChild(card);
  });
}

// 1-second live countdown ticker for dashboard snooze cards
setInterval(() => {
  const activeTab = document.getElementById('tab-snooze');
  if (!activeTab || !activeTab.classList.contains('active')) return;

  const tickerEls = document.querySelectorAll('.snooze-live-ticker[data-due]');
  tickerEls.forEach((el) => {
    const due = el.dataset.due;
    const diff = new Date(due).getTime() - Date.now();
    const card = el.closest('.snooze-card');

    if (diff <= 0) {
      el.className = 'badge-snooze-due';
      el.textContent = '⏰ Overdue 0s';
      if (card) {
        card.className = 'snooze-card due';
        const fill = card.querySelector('.snooze-progress-fill');
        if (fill) fill.style.width = '100%';
      }
    } else {
      el.textContent = `⏳ ${formatDashboardSnoozeRemaining(due)}`;
      if (card) {
        const snooze = currentSnoozes.find((x) => x.id === el.dataset.id);
        if (snooze) {
          const fill = card.querySelector('.snooze-progress-fill');
          if (fill) fill.style.width = `${calculateDashboardSnoozeProgress(snooze)}%`;
        }
      }
    }
  });
}, 1000);

// ==========================================
// TAB: QUICK SNIPPETS MANAGER (/shortcuts)
// ==========================================

let currentSnippets = [];

function setupSnippetsTab() {
  // Modal open
  document.getElementById('btnOpenNewSnippetModal')?.addEventListener('click', () => {
    openSnippetModal();
  });

  // Modal close
  document.getElementById('btnCloseSnippetModal')?.addEventListener('click', closeSnippetModal);
  document.getElementById('btnCancelSnippetModal')?.addEventListener('click', closeSnippetModal);

  // Variable pills in modal
  document.querySelectorAll('#snippetModal .btn-var-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.var;
      const textarea = document.getElementById('snippetBody');
      if (textarea && v) {
        const start = textarea.selectionStart || textarea.value.length;
        const end = textarea.selectionEnd || textarea.value.length;
        const text = textarea.value;
        textarea.value = text.substring(0, start) + v + text.substring(end);
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = start + v.length;
      }
    });
  });

  // Save snippet
  document.getElementById('btnSaveSnippetModal')?.addEventListener('click', saveSnippetFromModal);
}

function openSnippetModal(snippetId = null) {
  const modal = document.getElementById('snippetModal');
  const titleEl = document.getElementById('snippetModalTitle');
  const idInput = document.getElementById('snippetModalId');
  const shortcutInput = document.getElementById('snippetShortcut');
  const nameInput = document.getElementById('snippetTitle');
  const catInput = document.getElementById('snippetCategory');
  const bodyInput = document.getElementById('snippetBody');

  if (snippetId) {
    const tpl = currentSnippets.find((t) => t.id === snippetId);
    if (tpl) {
      titleEl.textContent = '⚡ Edit Quick Snippet';
      idInput.value = tpl.id;
      shortcutInput.value = tpl.shortcut || '';
      nameInput.value = tpl.title || '';
      catInput.value = tpl.category || 'Quick Snippets';
      bodyInput.value = tpl.body || '';
    }
  } else {
    titleEl.textContent = '⚡ Create Quick Snippet';
    idInput.value = '';
    shortcutInput.value = '';
    nameInput.value = '';
    catInput.value = 'Quick Snippets';
    bodyInput.value = '';
  }

  modal?.classList.remove('hidden');
  setTimeout(() => shortcutInput?.focus(), 50);
}

function closeSnippetModal() {
  document.getElementById('snippetModal')?.classList.add('hidden');
}

async function saveSnippetFromModal() {
  const id = document.getElementById('snippetModalId').value.trim();
  let shortcut = document.getElementById('snippetShortcut').value.trim().replace(/^\/+/, '').toLowerCase();
  const title = document.getElementById('snippetTitle').value.trim();
  const category = document.getElementById('snippetCategory').value.trim() || 'Quick Snippets';
  const body = document.getElementById('snippetBody').value.trim();

  if (!shortcut) {
    alert('Please enter a shortcut trigger (e.g. gf, pricing, cal).');
    return;
  }

  if (!body) {
    alert('Please enter snippet message content.');
    return;
  }

  const payload = {
    shortcut,
    title: title || `/${shortcut}`,
    category,
    body,
    variables: body.includes('{{name}}') ? ['name'] : []
  };

  if (id) {
    payload.id = id;
  }

  await StorageService.saveTemplate(payload);
  closeSnippetModal();
  await refreshSnippetsList();
  await refreshTemplatesList();
}

async function refreshSnippetsList() {
  const allTemplates = await StorageService.getTemplates();
  // Filter templates that have a shortcut or are in Quick Snippets
  currentSnippets = allTemplates.filter((t) => t.shortcut || t.category === 'Quick Snippets');

  // Update nav badge
  const badge = document.getElementById('navSnippetsBadge');
  if (badge) {
    badge.textContent = String(currentSnippets.length);
  }

  renderSnippetsGrid();
}

function renderSnippetsGrid() {
  const container = document.getElementById('snippetsListContainer');
  if (!container) return;

  if (currentSnippets.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; background: #FFFFFF; border: 1px dashed #CBD5E1; border-radius: 12px;">
        <div style="font-size: 36px; margin-bottom: 8px;">⚡</div>
        <h4 style="font-size: 16px; font-weight: 700; color: #0F172A; margin: 0 0 6px 0;">No Quick Snippets Yet</h4>
        <p style="font-size: 13px; color: #64748B; margin: 0 0 16px 0;">Create snippets with shortcuts like /gf, /cal, or /pricing to insert them with 1 keystroke in WhatsApp Web.</p>
        <button type="button" class="btn btn-primary btn-sm" id="btnEmptyCreateSnippet">+ Create First Snippet</button>
      </div>
    `;
    container.querySelector('#btnEmptyCreateSnippet')?.addEventListener('click', () => openSnippetModal());
    return;
  }

  container.innerHTML = '';

  currentSnippets.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'snippet-card';

    const shortcutText = s.shortcut ? `/${s.shortcut}` : '/snippet';

    card.innerHTML = `
      <div class="snippet-card-top">
        <span class="snippet-shortcut-pill">${escapeHtml(shortcutText)}</span>
        <h4 class="snippet-card-title">${escapeHtml(s.title || 'Quick Snippet')}</h4>
      </div>

      <div class="snippet-card-body">${escapeHtml(s.body || '')}</div>

      <div class="snippet-card-actions">
        <button type="button" class="btn btn-outline btn-sm btn-copy-snippet" title="Copy to clipboard">📋 Copy</button>
        <button type="button" class="btn btn-outline btn-sm btn-edit-snippet">✏️ Edit</button>
        <button type="button" class="btn btn-neutral btn-sm btn-delete-snippet" title="Delete snippet">🗑️</button>
      </div>
    `;

    // Copy action
    card.querySelector('.btn-copy-snippet')?.addEventListener('click', () => {
      navigator.clipboard.writeText(s.body || '');
      const btn = card.querySelector('.btn-copy-snippet');
      if (btn) {
        btn.textContent = '✓ Copied!';
        setTimeout(() => (btn.textContent = '📋 Copy'), 1500);
      }
    });

    // Edit action
    card.querySelector('.btn-edit-snippet')?.addEventListener('click', () => {
      openSnippetModal(s.id);
    });

    // Delete action
    card.querySelector('.btn-delete-snippet')?.addEventListener('click', async () => {
      if (confirm(`Delete snippet "/${s.shortcut}" (${s.title})?`)) {
        await StorageService.deleteTemplate(s.id);
        await refreshSnippetsList();
        await refreshTemplatesList();
      }
    });

    container.appendChild(card);
  });
}

// ==========================================
// TAB 5: SETTINGS & BACKUP
// ==========================================

function setupSettingsTab() {
  document.getElementById('btnSaveGeneralSettings')?.addEventListener('click', async () => {
    const cc = document.getElementById('settingsDefaultCC').value;
    const pacing = parseInt(document.getElementById('settingsPacingSeconds').value, 10) || 4;
    const soundEnabled = document.getElementById('settingsSoundEnabled').checked;
    const autoLoad = document.getElementById('settingsAutoLoadNext').checked;

    await StorageService.saveSettings({
      defaultCountryCode: cc,
      defaultPacingSeconds: pacing,
      soundEnabled,
      autoLoadNext: autoLoad
    });
    currentSettings = await StorageService.getSettings();
    alert('Settings saved successfully!');
  });

  document.getElementById('btnSettingsTestChime')?.addEventListener('click', () => {
    SoundPlayer.playChime(currentSettings ? currentSettings.soundVolume : 0.8);
  });

  // Export all data
  document.getElementById('btnExportAllData')?.addEventListener('click', async () => {
    const data = await StorageService.exportAllData();
    const str = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
    const link = document.createElement('a');
    link.setAttribute('href', str);
    link.setAttribute('download', `PingLater_Full_Backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // Import backup
  const importInput = document.getElementById('importBackupInput');
  document.getElementById('btnTriggerImport')?.addEventListener('click', () => importInput.click());
  importInput?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const parsed = JSON.parse(evt.target.result);
          await StorageService.importAllData(parsed);
          alert('Backup restored successfully!');
          window.location.reload();
        } catch (err) {
          alert('Invalid JSON backup file.');
        }
      };
      reader.readAsText(e.target.files[0]);
    }
  });

  // Clear data
  document.getElementById('btnClearAllData')?.addEventListener('click', async () => {
    if (confirm('DANGER: This will erase all batches, custom templates, and contacts. Are you sure?')) {
      await StorageService.clearAllData();
      alert('All stored data has been cleared.');
      window.location.reload();
    }
  });
}

function populateSettingsForm() {
  if (!currentSettings) return;
  const cc = document.getElementById('settingsDefaultCC');
  if (cc && currentSettings.defaultCountryCode) cc.value = currentSettings.defaultCountryCode;

  const pacing = document.getElementById('settingsPacingSeconds');
  if (pacing && currentSettings.defaultPacingSeconds) pacing.value = currentSettings.defaultPacingSeconds;

  const sound = document.getElementById('settingsSoundEnabled');
  if (sound) sound.checked = currentSettings.soundEnabled !== false;

  const autoLoad = document.getElementById('settingsAutoLoadNext');
  if (autoLoad) autoLoad.checked = currentSettings.autoLoadNext !== false;
}

// ==========================================
// GLOBAL ACTIONS & UTILITIES
// ==========================================

function setupGlobalActions() {
  document.getElementById('btnLaunchSidePanel')?.addEventListener('click', async () => {
    try {
      if (chrome.sidePanel && chrome.sidePanel.open) {
        const win = await chrome.windows.getCurrent();
        await chrome.sidePanel.open({ windowId: win.id });
        return;
      }
    } catch (err) {
      console.warn('[PingLater] Direct sidePanel.open failed:', err);
    }
    // Fallback: Opens side panel in helper docked window
    window.open(
      chrome.runtime.getURL('sidepanel.html'),
      'PingLaterSidePanel',
      'width=420,height=760,left=' + (window.screen.width - 440) + ',top=80'
    );
  });
}

function downloadBatchCSV(batch) {
  if (!batch || !batch.recipients) return;
  const rows = [];
  const headers = ['Name', 'Phone', 'Status', 'SentAt', 'SkippedAt'];
  rows.push(headers.join(','));

  batch.recipients.forEach((r) => {
    rows.push([
      `"${(r.name || '').replace(/"/g, '""')}"`,
      r.phone,
      r.status,
      r.sentAt || '',
      r.skippedAt || ''
    ].join(','));
  });

  const csv = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n'));
  const link = document.createElement('a');
  link.setAttribute('href', csv);
  link.setAttribute('download', `${batch.title.replace(/\s+/g, '_')}_Report.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ========================================================
// CONTROLLER: MULTI-STEP FOLLOW-UP CADENCES (FEATURE 5)
// ========================================================

let currentCadenceView = 'pipeline';
let parsedCadenceCsvLeads = [];

export function setupCadencesTab() {
  // 1. Sub-Tab Switching (Pipeline vs Blueprints)
  const subtabBtns = document.querySelectorAll('.btn-cadence-subtab');
  subtabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-cadence-view');
      switchCadenceView(view);
    });
  });

  // 2. Filter & Search listeners
  document.getElementById('cadenceSearchInput')?.addEventListener('input', renderCadencePipeline);
  document.getElementById('cadenceFilterStatus')?.addEventListener('change', renderCadencePipeline);
  document.getElementById('cadenceFilterBlueprint')?.addEventListener('change', renderCadencePipeline);

  // 3. Modal Openers
  document.getElementById('btnOpenCadenceModal')?.addEventListener('click', () => {
    openCadenceBuilderModal();
  });

  document.getElementById('btnOpenCadenceEnrollModal')?.addEventListener('click', () => {
    openCadenceEnrollModal();
  });

  // 4. Modal Closers
  document.getElementById('btnCloseCadenceModal')?.addEventListener('click', closeCadenceBuilderModal);
  document.getElementById('btnCancelCadenceModal')?.addEventListener('click', closeCadenceBuilderModal);
  document.getElementById('btnCloseCadenceEnrollModal')?.addEventListener('click', closeCadenceEnrollModal);
  document.getElementById('btnCancelCadenceEnrollModal')?.addEventListener('click', closeCadenceEnrollModal);

  // 5. Cadence Builder: Add Step button
  document.getElementById('btnAddCadenceStep')?.addEventListener('click', () => {
    const container = document.getElementById('cadenceStepsContainer');
    if (!container) return;
    const currentStepCount = container.querySelectorAll('.cadence-step-builder-card').length;
    const defaultDelay = currentStepCount === 0 ? 0 : 3;
    const newStep = {
      title: `Follow-up #${currentStepCount}`,
      delayDays: defaultDelay,
      delayHours: defaultDelay * 24,
      message: 'Hey {{name}}, following up on our previous chat! Let me know if you need any info.'
    };
    appendStepBuilderCard(container, newStep, currentStepCount);
    renumberStepBuilderCards();
  });

  // 6. Cadence Builder: Save Blueprint
  document.getElementById('btnSaveCadenceModal')?.addEventListener('click', saveCadenceBlueprintFromModal);

  // 7. Enroll Modal: Mode Tabs (Single vs Batch)
  const enrollTabs = document.querySelectorAll('.btn-enroll-tab');
  enrollTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.getAttribute('data-enroll-mode');
      enrollTabs.forEach((t) => t.classList.toggle('active', t === tab));
      document.getElementById('enrollModeSingle')?.classList.toggle('hidden', mode !== 'single');
      document.getElementById('enrollModeBatch')?.classList.toggle('hidden', mode !== 'batch');
    });
  });

  // 8. Enroll Modal: Batch CSV Dropzone & File Input
  setupCadenceCsvDropzone();

  // 9. Enroll Modal: Submit Enrollment
  document.getElementById('btnSubmitCadenceEnroll')?.addEventListener('click', submitCadenceEnrollment);

  // 10. Queue Due Cadences in Side Panel
  document.getElementById('btnQueueDueCadences')?.addEventListener('click', queueDueCadencesInSidePanel);

  // 11. Live Ticker for countdowns
  setInterval(() => {
    if (currentTab === 'tab-cadences' && currentCadenceView === 'pipeline') {
      updateCadencePipelineCountdowns();
    }
  }, 1000);
}

function switchCadenceView(view) {
  currentCadenceView = view;
  document.querySelectorAll('.btn-cadence-subtab').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-cadence-view') === view);
  });
  document.getElementById('cadenceViewPipeline')?.classList.toggle('hidden', view !== 'pipeline');
  document.getElementById('cadenceViewBlueprints')?.classList.toggle('hidden', view !== 'blueprints');
}

export async function refreshCadencesData() {
  try {
    currentCadenceBlueprints = await StorageService.getCadenceBlueprints();
    const { all } = await StorageService.refreshDueCadenceEnrollments();
    currentCadenceEnrollments = all;

    // Update KPI metrics
    const metrics = calculateCadenceMetrics(currentCadenceEnrollments);
    const activeBpEl = document.getElementById('cadenceMetricActiveCadences');
    if (activeBpEl) activeBpEl.textContent = String(currentCadenceBlueprints.length);

    const enrolledEl = document.getElementById('cadenceMetricTotalEnrolled');
    if (enrolledEl) enrolledEl.textContent = String(metrics.total);

    const dueEl = document.getElementById('cadenceMetricDueNow');
    if (dueEl) dueEl.textContent = String(metrics.due);

    const replyEl = document.getElementById('cadenceMetricReplyRate');
    if (replyEl) replyEl.textContent = `${metrics.replyRatePct}%`;

    // Badges in subtab and sidebar
    const pipeBadge = document.getElementById('cadencePipelineBadge');
    if (pipeBadge) pipeBadge.textContent = String(metrics.total);

    const bpBadge = document.getElementById('cadenceBlueprintsBadge');
    if (bpBadge) bpBadge.textContent = String(currentCadenceBlueprints.length);

    const navBadge = document.getElementById('navCadenceBadge');
    if (navBadge) {
      if (metrics.due > 0) {
        navBadge.textContent = String(metrics.due);
        navBadge.classList.remove('hidden');
      } else {
        navBadge.classList.add('hidden');
      }
    }

    // Populate filter and enroll select dropdowns
    populateCadenceFilterSelect();

    // Render active views
    renderCadencePipeline();
    renderCadenceBlueprints();
  } catch (err) {
    console.warn('[PingLater] Error refreshing cadences data:', err);
  }
}

function populateCadenceFilterSelect() {
  const filterSelect = document.getElementById('cadenceFilterBlueprint');
  const enrollSelect = document.getElementById('cadenceEnrollSelect');

  if (filterSelect) {
    const prevVal = filterSelect.value;
    filterSelect.innerHTML = `<option value="all">All Cadence Sequences</option>`;
    currentCadenceBlueprints.forEach((bp) => {
      filterSelect.innerHTML += `<option value="${escapeHtml(bp.id)}">${escapeHtml(bp.name)}</option>`;
    });
    if (prevVal) filterSelect.value = prevVal;
  }

  if (enrollSelect) {
    const prevEnroll = enrollSelect.value;
    enrollSelect.innerHTML = '';
    currentCadenceBlueprints.forEach((bp) => {
      enrollSelect.innerHTML += `<option value="${escapeHtml(bp.id)}">${escapeHtml(bp.name)} (${bp.steps?.length || 0} steps)</option>`;
    });
    if (prevEnroll) enrollSelect.value = prevEnroll;
  }
}

function renderCadencePipeline() {
  const container = document.getElementById('cadencePipelineList');
  if (!container) return;

  const searchQuery = (document.getElementById('cadenceSearchInput')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('cadenceFilterStatus')?.value || 'all';
  const blueprintFilter = document.getElementById('cadenceFilterBlueprint')?.value || 'all';

  let list = [...currentCadenceEnrollments];

  // Search filter
  if (searchQuery) {
    list = list.filter((e) => {
      const name = (e.contactName || '').toLowerCase();
      const phone = (e.phone || '').toLowerCase();
      return name.includes(searchQuery) || phone.includes(searchQuery);
    });
  }

  // Status filter
  if (statusFilter !== 'all') {
    list = list.filter((e) => e.status === statusFilter);
  }

  // Blueprint filter
  if (blueprintFilter !== 'all') {
    list = list.filter((e) => e.cadenceId === blueprintFilter);
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1; padding: 48px; text-align: center; background: #FFFFFF; border: 1px dashed #CBD5E1; border-radius: 12px;">
        <div style="font-size: 40px; margin-bottom: 12px;">🎯</div>
        <h3 style="margin: 0 0 6px; font-size: 17px; font-weight: 800; color: #0F172A;">No Leads in This Cadence View</h3>
        <p style="margin: 0 0 18px; font-size: 13.5px; color: #64748B;">
          ${searchQuery || statusFilter !== 'all' ? 'Try adjusting your search filters or status selection.' : 'Enroll leads into a multi-step sequence to automate your follow-ups.'}
        </p>
        <button type="button" class="btn btn-primary" onclick="document.getElementById('btnOpenCadenceEnrollModal').click()" style="background: #6366F1;">
          🚀 Enroll First Lead
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  list.forEach((enr) => {
    const card = document.createElement('div');
    card.className = `cadence-pipeline-card ${enr.status}`;
    card.setAttribute('data-enr-id', enr.id);

    const bp = currentCadenceBlueprints.find((b) => b.id === enr.cadenceId);
    const totalSteps = enr.totalSteps || bp?.steps?.length || 3;
    const currentStepNum = Math.min((enr.currentStepIndex || 0) + 1, totalSteps);
    const currentStepDef = bp?.steps ? bp.steps[enr.currentStepIndex] : null;
    const currentStepTitle = currentStepDef?.title || `Step ${currentStepNum}`;
    const progressPct = Math.round((currentStepNum / totalSteps) * 100);

    // Format status and countdown
    let statusBadgeClass = enr.status;
    let statusLabel = enr.status.toUpperCase();
    let dueBannerClass = 'cadence-next-due-banner';
    let dueBannerText = '';

    if (enr.status === CADENCE_STATUS.DUE) {
      statusLabel = '⚠️ DUE NOW';
      dueBannerClass += ' due';
      dueBannerText = '⚠️ Ready to send! Delay has elapsed.';
    } else if (enr.status === CADENCE_STATUS.AWAITING_REPLY) {
      statusLabel = '⏳ AWAITING';
      dueBannerText = `⏳ Next step in: <span class="cadence-live-countdown" data-due="${escapeHtml(enr.nextStepDueAt)}">${formatRemainingCadenceTime(enr.nextStepDueAt)}</span>`;
    } else if (enr.status === CADENCE_STATUS.REPLIED) {
      statusLabel = '🎉 REPLIED (HALTED)';
      dueBannerText = `🎉 Contact replied on WhatsApp! Cadence permanently stopped.`;
    } else if (enr.status === CADENCE_STATUS.COMPLETED) {
      statusLabel = '✓ COMPLETED';
      dueBannerText = `✓ All ${totalSteps} sequence steps have been sent.`;
    } else if (enr.status === CADENCE_STATUS.PAUSED) {
      statusLabel = '⏸️ PAUSED';
      dueBannerText = `⏸️ Sequence is temporarily paused.`;
    }

    card.innerHTML = `
      <div class="cadence-card-header">
        <div>
          <h4 class="cadence-contact-title">${escapeHtml(enr.contactName)}</h4>
          <div class="cadence-contact-phone">${escapeHtml(enr.phone || enr.cleanPhone)}</div>
        </div>
        <span class="cadence-badge-status ${statusBadgeClass}">${statusLabel}</span>
      </div>

      <div class="cadence-blueprint-tag">🎯 ${escapeHtml(enr.cadenceName || bp?.name || 'Cadence')}</div>

      <div>
        <div class="cadence-step-info-row">
          <span>Step ${currentStepNum} of ${totalSteps}</span>
          <span style="color:#6366F1;">${escapeHtml(currentStepTitle)}</span>
        </div>
        <div class="cadence-progress-track">
          <div class="cadence-progress-fill" style="width: ${progressPct}%"></div>
        </div>
      </div>

      <div class="${dueBannerClass}">
        ${dueBannerText}
      </div>

      <div class="cadence-pipeline-actions">
        ${enr.status === CADENCE_STATUS.DUE || enr.status === CADENCE_STATUS.AWAITING_REPLY ? `
          <button type="button" class="btn btn-sm btn-primary btn-cadence-send-now" style="background:#4F46E5;">
            💬 Open & Review
          </button>
          <button type="button" class="btn btn-sm btn-outline btn-cadence-advance">
            ✓ Mark Sent
          </button>
        ` : ''}

        ${enr.status === CADENCE_STATUS.PAUSED ? `
          <button type="button" class="btn btn-sm btn-outline btn-cadence-resume">
            ▶️ Resume
          </button>
        ` : (enr.status === CADENCE_STATUS.AWAITING_REPLY || enr.status === CADENCE_STATUS.DUE ? `
          <button type="button" class="btn btn-sm btn-outline btn-cadence-pause">
            ⏸️ Pause
          </button>
        ` : '')}

        ${enr.status !== CADENCE_STATUS.REPLIED && enr.status !== CADENCE_STATUS.COMPLETED ? `
          <button type="button" class="btn btn-sm btn-outline btn-cadence-mark-replied" title="Stop sequence because contact replied">
            🎉 Mark Replied
          </button>
        ` : ''}

        <button type="button" class="btn btn-sm btn-outline btn-cadence-delete" style="color:#EF4444;" title="Cancel & delete enrollment">
          ✕
        </button>
      </div>
    `;

    // Action button listeners
    card.querySelector('.btn-cadence-send-now')?.addEventListener('click', () => {
      openCadenceStepInWhatsApp(enr, bp);
    });

    card.querySelector('.btn-cadence-advance')?.addEventListener('click', async () => {
      await advanceCadenceStep(enr.id);
    });

    card.querySelector('.btn-cadence-pause')?.addEventListener('click', async () => {
      const paused = pauseEnrollment(enr);
      await StorageService.saveCadenceEnrollment(paused);
      await refreshCadencesData();
    });

    card.querySelector('.btn-cadence-resume')?.addEventListener('click', async () => {
      const resumed = resumeEnrollment(enr);
      await StorageService.saveCadenceEnrollment(resumed);
      await refreshCadencesData();
    });

    card.querySelector('.btn-cadence-mark-replied')?.addEventListener('click', async () => {
      const replied = recordContactReplied(enr);
      await StorageService.saveCadenceEnrollment(replied);
      await refreshCadencesData();
    });

    card.querySelector('.btn-cadence-delete')?.addEventListener('click', async () => {
      if (confirm(`Remove ${enr.contactName} from ${enr.cadenceName}?`)) {
        await StorageService.deleteCadenceEnrollment(enr.id);
        await refreshCadencesData();
      }
    });

    container.appendChild(card);
  });
}

function updateCadencePipelineCountdowns() {
  const countdownEls = document.querySelectorAll('.cadence-live-countdown');
  countdownEls.forEach((el) => {
    const dueIso = el.getAttribute('data-due');
    if (dueIso) {
      el.textContent = formatRemainingCadenceTime(dueIso);
    }
  });
}

function formatRemainingCadenceTime(dueAtIso) {
  if (!dueAtIso) return '0s';
  const diffMs = new Date(dueAtIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Due Now';
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

function renderCadenceBlueprints() {
  const container = document.getElementById('cadenceBlueprintsGrid');
  if (!container) return;

  container.innerHTML = '';
  currentCadenceBlueprints.forEach((bp) => {
    const card = document.createElement('div');
    card.className = 'cadence-blueprint-card';

    const enrolledCount = currentCadenceEnrollments.filter((e) => e.cadenceId === bp.id).length;
    const steps = bp.steps || [];

    // Step nodes visual timeline
    let stepsFlowHtml = '';
    steps.forEach((s, idx) => {
      const delayLabel = idx === 0 ? 'Day 1' : `+${formatDelayText(s.delayDays, s.delayHours)}`;
      stepsFlowHtml += `
        <div class="cadence-step-node">
          <span style="font-size:10px; color:#64748B;">${delayLabel}</span>
          <span class="step-title">${escapeHtml(s.title || `Step ${idx + 1}`)}</span>
        </div>
      `;
      if (idx < steps.length - 1) {
        stepsFlowHtml += `<span class="cadence-step-arrow">➔</span>`;
      }
    });

    card.innerHTML = `
      <div class="cadence-blueprint-top">
        <div>
          <span class="cadence-blueprint-tag">${escapeHtml(bp.category || 'Outreach')}</span>
          <h4 class="cadence-blueprint-name mt-1">${escapeHtml(bp.name)}</h4>
        </div>
        ${bp.isPreset ? `<span style="font-size:11px; background:#F1F5F9; color:#475569; padding:2px 6px; border-radius:4px; font-weight:700;">PRESET</span>` : ''}
      </div>

      <p class="cadence-blueprint-desc">${escapeHtml(bp.description || 'Automated multi-step follow-up sequence.')}</p>

      <div class="cadence-steps-flow">
        ${stepsFlowHtml}
      </div>

      <div class="cadence-blueprint-footer">
        <span style="font-size:12.5px; color:#64748B; font-weight:600;">
          👥 <strong>${enrolledCount}</strong> active lead${enrolledCount === 1 ? '' : 's'}
        </span>
        <div style="display:flex; gap:6px;">
          <button type="button" class="btn btn-sm btn-primary btn-enroll-this-cadence" style="background:#6366F1;">
            🚀 Enroll Leads
          </button>
          <button type="button" class="btn btn-sm btn-outline btn-edit-this-cadence">
            ✏️ Edit
          </button>
          ${!bp.isPreset ? `
            <button type="button" class="btn btn-sm btn-outline btn-delete-this-cadence" style="color:#EF4444;">
              🗑️
            </button>
          ` : ''}
        </div>
      </div>
    `;

    card.querySelector('.btn-enroll-this-cadence')?.addEventListener('click', () => {
      openCadenceEnrollModal(bp.id);
    });

    card.querySelector('.btn-edit-this-cadence')?.addEventListener('click', () => {
      openCadenceBuilderModal(bp);
    });

    card.querySelector('.btn-delete-this-cadence')?.addEventListener('click', async () => {
      if (confirm(`Delete cadence blueprint "${bp.name}"?`)) {
        await StorageService.deleteCadenceBlueprint(bp.id);
        await refreshCadencesData();
      }
    });

    container.appendChild(card);
  });
}

// ========================================================
// CADENCE BUILDER MODAL
// ========================================================

function openCadenceBuilderModal(blueprintToEdit = null) {
  const modal = document.getElementById('cadenceModal');
  const title = document.getElementById('cadenceModalTitle');
  const idInput = document.getElementById('cadenceModalId');
  const nameInput = document.getElementById('cadenceModalName');
  const catInput = document.getElementById('cadenceModalCategory');
  const descInput = document.getElementById('cadenceModalDesc');
  const container = document.getElementById('cadenceStepsContainer');

  if (!modal || !container) return;

  container.innerHTML = '';

  if (blueprintToEdit) {
    title.textContent = `✏️ Edit Cadence: ${blueprintToEdit.name}`;
    idInput.value = blueprintToEdit.id;
    nameInput.value = blueprintToEdit.name;
    catInput.value = blueprintToEdit.category || 'Sales Outreach';
    descInput.value = blueprintToEdit.description || '';

    (blueprintToEdit.steps || []).forEach((s, idx) => {
      appendStepBuilderCard(container, s, idx);
    });
  } else {
    title.textContent = '🎯 Create Follow-Up Cadence';
    idInput.value = '';
    nameInput.value = '';
    catInput.value = 'Sales Outreach';
    descInput.value = '';

    // Default 3 starter steps
    appendStepBuilderCard(container, { title: 'Initial Value Outreach', delayDays: 0, delayHours: 0, message: 'Hi {{name}}, noticed your work on {{project}}! Would you be open to a 5-min chat this week?' }, 0);
    appendStepBuilderCard(container, { title: '3-Day Value Bump', delayDays: 3, delayHours: 72, message: 'Hey {{name}}, just bumping this in case it got buried! Let me know if you want to explore.' }, 1);
    appendStepBuilderCard(container, { title: '7-Day Polite Break-Up', delayDays: 4, delayHours: 96, message: 'Hi {{name}}, assume priorities shifted right now! I will stop following up for now. Wishing you the best!' }, 2);
  }

  renumberStepBuilderCards();
  modal.classList.remove('hidden');
}

function closeCadenceBuilderModal() {
  document.getElementById('cadenceModal')?.classList.add('hidden');
}

function appendStepBuilderCard(container, stepData = {}, index = 0) {
  const card = document.createElement('div');
  card.className = 'cadence-step-builder-card';

  card.innerHTML = `
    <div class="cadence-step-builder-header">
      <span class="cadence-step-number-pill">Step ${index + 1}</span>
      <button type="button" class="btn-remove-step" title="Delete this step">✕ Remove Step</button>
    </div>

    <div class="form-grid-2">
      <div class="form-group">
        <label>Step Title</label>
        <input type="text" class="form-input step-input-title" value="${escapeHtml(stepData.title || `Step ${index + 1}`)}" placeholder="e.g. Value Bump">
      </div>
      <div class="form-group">
        <label>Delay After Previous Step</label>
        <div style="display:flex; gap:8px; align-items:center;">
          <input type="number" min="0" class="form-input step-input-days" value="${stepData.delayDays !== undefined ? stepData.delayDays : 2}" style="width:75px;">
          <span style="font-size:13px; color:#64748B;">days</span>
          <input type="number" min="0" max="23" class="form-input step-input-hours" value="${stepData.delayHours ? stepData.delayHours % 24 : 0}" style="width:70px;">
          <span style="font-size:13px; color:#64748B;">hours</span>
        </div>
      </div>
    </div>

    <div class="form-group mt-2">
      <label>Message Content</label>
      <div class="variable-pills" style="margin-bottom:6px;">
        <span class="pill-label" style="font-size:11px;">Insert variable:</span>
        <button type="button" class="btn-var-pill" data-step-var="{{name}}">{{name}}</button>
        <button type="button" class="btn-var-pill" data-step-var="{{company}}">{{company}}</button>
        <button type="button" class="btn-var-pill" data-step-var="{{project}}">{{project}}</button>
      </div>
      <textarea rows="3" class="form-textarea step-input-message" placeholder="Message content for this step...">${escapeHtml(stepData.message || '')}</textarea>
      <div style="margin-top:4px; font-size:11.5px; color:#64748B;">
        ${index === 0 ? '⚡ <strong>Step 1</strong> sends immediately or when scheduled.' : '🛡️ <strong>Stop-on-Reply:</strong> Only sends if contact hasn\'t replied yet.'}
      </div>
    </div>
  `;

  // Remove button
  card.querySelector('.btn-remove-step')?.addEventListener('click', () => {
    card.remove();
    renumberStepBuilderCards();
  });

  // Variable pills
  card.querySelectorAll('.btn-var-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const v = pill.getAttribute('data-step-var');
      const textarea = card.querySelector('.step-input-message');
      if (textarea && v) {
        insertTextAtCursor(textarea, v);
      }
    });
  });

  container.appendChild(card);
}

function renumberStepBuilderCards() {
  const container = document.getElementById('cadenceStepsContainer');
  if (!container) return;
  const cards = container.querySelectorAll('.cadence-step-builder-card');
  cards.forEach((card, idx) => {
    const pill = card.querySelector('.cadence-step-number-pill');
    if (pill) pill.textContent = `Step ${idx + 1}`;
    const removeBtn = card.querySelector('.btn-remove-step');
    if (removeBtn) {
      removeBtn.style.display = cards.length <= 1 ? 'none' : 'inline-block';
    }
  });
}

function insertTextAtCursor(input, text) {
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const val = input.value;
  input.value = val.substring(0, start) + text + val.substring(end);
  input.selectionStart = input.selectionEnd = start + text.length;
  input.focus();
}

async function saveCadenceBlueprintFromModal() {
  const idInput = document.getElementById('cadenceModalId');
  const nameInput = document.getElementById('cadenceModalName');
  const catInput = document.getElementById('cadenceModalCategory');
  const descInput = document.getElementById('cadenceModalDesc');
  const container = document.getElementById('cadenceStepsContainer');

  const name = nameInput?.value?.trim();
  if (!name) {
    alert('Please enter a Cadence Name.');
    nameInput?.focus();
    return;
  }

  const cards = container?.querySelectorAll('.cadence-step-builder-card') || [];
  if (cards.length === 0) {
    alert('Cadence must contain at least 1 step.');
    return;
  }

  const steps = [];
  cards.forEach((c, idx) => {
    const title = c.querySelector('.step-input-title')?.value?.trim() || `Step ${idx + 1}`;
    const days = parseInt(c.querySelector('.step-input-days')?.value, 10) || 0;
    const hours = parseInt(c.querySelector('.step-input-hours')?.value, 10) || 0;
    const totalHours = (days * 24) + hours;
    const msg = c.querySelector('.step-input-message')?.value?.trim() || '';

    steps.push({
      stepIndex: idx,
      stepNumber: idx + 1,
      title: title,
      delayDays: days,
      delayHours: totalHours,
      message: msg,
      condition: idx === 0 ? 'always' : 'if_no_reply'
    });
  });

  const blueprint = createCadenceBlueprint({
    id: idInput?.value || undefined,
    name: name,
    category: catInput?.value || 'Sales Outreach',
    description: descInput?.value || '',
    steps: steps
  });

  await StorageService.saveCadenceBlueprint(blueprint);
  closeCadenceBuilderModal();
  await refreshCadencesData();
}

// ========================================================
// CADENCE ENROLL MODAL (SINGLE & CSV BATCH)
// ========================================================

function openCadenceEnrollModal(preselectedCadenceId = null) {
  const modal = document.getElementById('cadenceEnrollModal');
  const select = document.getElementById('cadenceEnrollSelect');
  if (!modal) return;

  if (select && preselectedCadenceId) {
    select.value = preselectedCadenceId;
  }

  // Clear single inputs
  const nameInput = document.getElementById('enrollSingleName');
  const phoneInput = document.getElementById('enrollSinglePhone');
  const compInput = document.getElementById('enrollSingleCompany');
  const projInput = document.getElementById('enrollSingleProject');
  if (nameInput) nameInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (compInput) compInput.value = '';
  if (projInput) projInput.value = '';

  parsedCadenceCsvLeads = [];
  const previewEl = document.getElementById('cadenceCsvPreview');
  if (previewEl) {
    previewEl.textContent = '';
    previewEl.classList.add('hidden');
  }

  modal.classList.remove('hidden');
}

function closeCadenceEnrollModal() {
  document.getElementById('cadenceEnrollModal')?.classList.add('hidden');
}

function setupCadenceCsvDropzone() {
  const dropzone = document.getElementById('cadenceCsvDropzone');
  const fileInput = document.getElementById('cadenceCsvFileInput');
  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '#6366F1';
    dropzone.style.background = '#EEF2FF';
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = '#CBD5E1';
    dropzone.style.background = 'transparent';
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '#CBD5E1';
    dropzone.style.background = 'transparent';
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleCadenceCsvFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleCadenceCsvFile(e.target.files[0]);
    }
  });
}

function handleCadenceCsvFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const text = e.target.result;
      const { headers, rows } = parseCSV(text);
      const cols = autoDetectColumns(headers);

      if (!cols.phone) {
        alert('Could not detect a Phone column in your CSV. Please ensure your CSV contains a phone number header.');
        return;
      }

      parsedCadenceCsvLeads = rows.map((r) => {
        const phone = r[cols.phone] || '';
        const name = cols.name ? r[cols.name] : 'Contact';
        return {
          name: name,
          phone: phone,
          variables: r
        };
      }).filter((c) => Boolean(normalizeCadencePhone(c.phone)));

      const previewEl = document.getElementById('cadenceCsvPreview');
      if (previewEl) {
        previewEl.textContent = `✅ Successfully extracted ${parsedCadenceCsvLeads.length} valid contacts from CSV!`;
        previewEl.classList.remove('hidden');
      }
    } catch (err) {
      alert('Error parsing CSV file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

async function submitCadenceEnrollment() {
  const cadenceId = document.getElementById('cadenceEnrollSelect')?.value;
  const cadence = currentCadenceBlueprints.find((b) => b.id === cadenceId);

  if (!cadence) {
    alert('Please select a valid Cadence.');
    return;
  }

  const isBatchMode = !document.getElementById('enrollModeBatch')?.classList.contains('hidden');

  let leadsToEnroll = [];

  if (isBatchMode) {
    if (parsedCadenceCsvLeads.length === 0) {
      alert('Please upload a CSV file with valid contacts first.');
      return;
    }
    leadsToEnroll = parsedCadenceCsvLeads;
  } else {
    const name = document.getElementById('enrollSingleName')?.value?.trim();
    const phone = document.getElementById('enrollSinglePhone')?.value?.trim();
    const company = document.getElementById('enrollSingleCompany')?.value?.trim();
    const project = document.getElementById('enrollSingleProject')?.value?.trim();

    if (!phone) {
      alert('Please enter a WhatsApp phone number.');
      document.getElementById('enrollSinglePhone')?.focus();
      return;
    }

    leadsToEnroll = [{
      name: name || 'Contact',
      phone: phone,
      company: company,
      project: project
    }];
  }

  const newEnrollments = enrollBatchInCadence(cadence, leadsToEnroll, currentCadenceEnrollments);
  if (newEnrollments.length === 0) {
    alert('No new leads enrolled (contacts may already be actively enrolled in this cadence).');
    return;
  }

  await StorageService.saveCadenceEnrollmentsBatch(newEnrollments);

  // Schedule background alarms for any items with scheduled nextStepDueAt
  newEnrollments.forEach((enr) => {
    if (enr.nextStepDueAt && enr.status === CADENCE_STATUS.AWAITING_REPLY) {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        chrome.runtime.sendMessage({
          type: 'SCHEDULE_CADENCE_ALARM',
          enrollmentId: enr.id,
          dueAt: enr.nextStepDueAt
        }).catch(() => {});
      }
    }
  });

  closeCadenceEnrollModal();
  await refreshCadencesData();
  alert(`🎉 Successfully enrolled ${newEnrollments.length} lead${newEnrollments.length === 1 ? '' : 's'} into "${cadence.name}"!`);
}

// ========================================================
// PIPELINE CARD ACTIONS & SIDE PANEL INTEGRATION
// ========================================================

function openCadenceStepInWhatsApp(enr, bp) {
  const cadence = bp || currentCadenceBlueprints.find((b) => b.id === enr.cadenceId);
  const step = cadence?.steps ? cadence.steps[enr.currentStepIndex] : null;
  const messageText = step ? interpolateCadenceMessage(step.message, enr.variables) : '';
  const cleanPhone = normalizeCadencePhone(enr.phone || enr.cleanPhone);

  const url = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(messageText)}`;
  window.open(url, '_blank');
}

async function advanceCadenceStep(enrollmentId) {
  const enr = currentCadenceEnrollments.find((e) => e.id === enrollmentId);
  if (!enr) return;
  const bp = currentCadenceBlueprints.find((b) => b.id === enr.cadenceId);

  try {
    const updated = recordStepSent(enr, bp);
    await StorageService.saveCadenceEnrollment(updated);

    if (updated.nextStepDueAt && updated.status === CADENCE_STATUS.AWAITING_REPLY) {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        chrome.runtime.sendMessage({
          type: 'SCHEDULE_CADENCE_ALARM',
          enrollmentId: updated.id,
          dueAt: updated.nextStepDueAt
        }).catch(() => {});
      }
    }

    await refreshCadencesData();
  } catch (err) {
    alert(err.message);
  }
}

async function queueDueCadencesInSidePanel() {
  const dueEnrollments = currentCadenceEnrollments.filter((e) => e.status === CADENCE_STATUS.DUE);
  if (dueEnrollments.length === 0) {
    alert('ℹ️ No cadence follow-ups are due right now! Check back when scheduled delays have elapsed.');
    return;
  }

  // Package due follow-ups into a batch for the Side Panel assembly line
  const recipients = dueEnrollments.map((enr) => {
    const bp = currentCadenceBlueprints.find((b) => b.id === enr.cadenceId);
    const step = bp?.steps ? bp.steps[enr.currentStepIndex] : null;
    const msg = step ? interpolateCadenceMessage(step.message, enr.variables) : 'Hi {{name}}!';

    return {
      name: enr.contactName,
      phone: enr.phone || enr.cleanPhone,
      cleanPhone: enr.cleanPhone,
      status: 'pending',
      renderedMessage: msg,
      cadenceEnrollmentId: enr.id
    };
  });

  const dueBatch = {
    id: `batch_cadence_due_${Date.now()}`,
    title: `🎯 Due Cadence Follow-Ups (${dueEnrollments.length} leads)`,
    messageTemplate: 'Hi {{name}}',
    recipients: recipients,
    status: BATCH_STATUS.IN_PROGRESS,
    scheduledAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    isCadenceBatch: true
  };

  await StorageService.saveBatch(dueBatch);

  // Launch Side Panel
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    chrome.runtime.sendMessage({ type: 'OPEN_WORKSPACE', batchId: dueBatch.id }).catch(() => {});
  }

  alert(`🚀 Queued ${dueEnrollments.length} due follow-ups into the Side Panel! Open WhatsApp Web to review and send.`);
}

