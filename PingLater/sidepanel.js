/**
 * PingLater - Side Panel Workspace Controller (Module 6)
 * Orchestrates the active follow-up queue, pacing timer,
 * WhatsApp tab navigation, keyboard shortcuts, and report export.
 */

import { StorageService, BATCH_STATUS, RECIPIENT_STATUS, SNOOZE_STATUS } from './utils/storage.js';
import { WhatsAppOrchestrator } from './utils/whatsapp.js';
import { SoundPlayer } from './utils/audio.js';
import { calculateNextRecurringDate, formatRecurrenceSummary } from './utils/recurring.js';
import { writeBackToGoogleSheet } from './utils/sheets.js';
import { recordStepSent } from './utils/cadence.js';

// Application State
let currentBatch = null;
let currentSettings = null;
let pacingInterval = null;
let isPacing = false;

// DOM Elements
const emptyStateSection = document.getElementById('emptyStateSection');
const activeWorkspaceSection = document.getElementById('activeWorkspaceSection');
const availableBatchesList = document.getElementById('availableBatchesList');
const btnCreateNewBatchEmpty = document.getElementById('btnCreateNewBatchEmpty');
const btnOpenDashboard = document.getElementById('btnOpenDashboard');

const batchTitle = document.getElementById('batchTitle');
const batchStatusBadge = document.getElementById('batchStatusBadge');
const statSent = document.getElementById('statSent');
const statSkipped = document.getElementById('statSkipped');
const statRemaining = document.getElementById('statRemaining');
const progressBarFill = document.getElementById('progressBarFill');
const progressPercent = document.getElementById('progressPercent');
const progressFraction = document.getElementById('progressFraction');

const pacingOverlay = document.getElementById('pacingOverlay');
const pacingSecondsText = document.getElementById('pacingSecondsText');
const btnSkipPacing = document.getElementById('btnSkipPacing');

const recipientCard = document.getElementById('recipientCard');
const recipientIndexBadge = document.getElementById('recipientIndexBadge');
const recipientStatusPill = document.getElementById('recipientStatusPill');
const recipientName = document.getElementById('recipientName');
const recipientPhone = document.getElementById('recipientPhone');
const recipientTagsList = document.getElementById('recipientTagsList');
const messageBodyPreview = document.getElementById('messageBodyPreview');
const btnCopyMessage = document.getElementById('btnCopyMessage');
const copyBtnLabel = document.getElementById('copyBtnLabel');

const btnEditRecipientMessage = document.getElementById('btnEditRecipientMessage');
const bubbleViewContainer = document.getElementById('bubbleViewContainer');
const inlineEditContainer = document.getElementById('inlineEditContainer');
const inlineMessageTextarea = document.getElementById('inlineMessageTextarea');
const btnCancelInlineEdit = document.getElementById('btnCancelInlineEdit');
const btnSaveInlineEdit = document.getElementById('btnSaveInlineEdit');

const btnLoadInWhatsApp = document.getElementById('btnLoadInWhatsApp');
const btnMarkSent = document.getElementById('btnMarkSent');
const btnSkip = document.getElementById('btnSkip');
const btnPrevRecipient = document.getElementById('btnPrevRecipient');
const btnPauseBatch = document.getElementById('btnPauseBatch');
const btnEndBatch = document.getElementById('btnEndBatch');
const btnHeaderEndJob = document.getElementById('btnHeaderEndJob');
const btnEndBatchFromPaused = document.getElementById('btnEndBatchFromPaused');
const btnCancelScheduledJob = document.getElementById('btnCancelScheduledJob');

const completionCard = document.getElementById('completionCard');
const completionSummaryText = document.getElementById('completionSummaryText');
const metricSentCount = document.getElementById('metricSentCount');
const metricSkippedCount = document.getElementById('metricSkippedCount');
const metricTotalCount = document.getElementById('metricTotalCount');
const btnExportReport = document.getElementById('btnExportReport');
const btnBackToDashboardFromComplete = document.getElementById('btnBackToDashboardFromComplete');

const togglePacingDelay = document.getElementById('togglePacingDelay');
const labelPacingSeconds = document.getElementById('labelPacingSeconds');
const btnTestSound = document.getElementById('btnTestSound');

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  await initSettings();
  setupEventListeners();
  await loadActiveOrTargetBatch();
});

async function initSettings() {
  currentSettings = await StorageService.getSettings();
  if (labelPacingSeconds) {
    labelPacingSeconds.textContent = `${currentSettings.defaultPacingSeconds || 10}s`;
  }
}

/**
 * Loads target batch: checks URL query param, then active batches in storage
 */
async function loadActiveOrTargetBatch(specificBatchId = null) {
  const urlParams = new URLSearchParams(window.location.search);
  const targetId = specificBatchId || urlParams.get('batchId') || (currentBatch ? currentBatch.id : null);

  const batches = await StorageService.getBatches();

  if (targetId) {
    const found = batches.find((b) => b.id === targetId);
    if (found && found.status !== BATCH_STATUS.COMPLETED && found.status !== BATCH_STATUS.CANCELLED) {
      return activateBatch(found);
    }
  }

  // Look for any batch that is in_progress, overdue, or scheduled
  const activeBatch = batches.find(
    (b) => b.status === BATCH_STATUS.IN_PROGRESS || b.status === BATCH_STATUS.OVERDUE
  ) || batches.find((b) => b.status === BATCH_STATUS.SCHEDULED) || batches.find((b) => b.status === BATCH_STATUS.PAUSED);

  if (activeBatch) {
    activateBatch(activeBatch);
  } else {
    renderEmptyState(batches);
  }
}

/**
 * Activates a batch inside the workspace view
 */
function activateBatch(batch) {
  currentBatch = batch;
  if (!currentBatch.recipients || currentBatch.recipients.length === 0) {
    renderEmptyState([]);
    return;
  }

  emptyStateSection.classList.add('hidden');
  activeWorkspaceSection.classList.remove('hidden');

  // Find next pending recipient or resume from currentIndex
  let idx = currentBatch.currentIndex || 0;
  if (idx >= currentBatch.recipients.length) {
    idx = currentBatch.recipients.length - 1;
  }

  currentBatch.currentIndex = idx;
  renderWorkspace();

  // If batch is already complete or ended, show completion card and STOP
  const isComplete = currentBatch.status === BATCH_STATUS.COMPLETED || currentBatch.recipients.every((r) => r.status === 'sent' || r.status === 'skipped');
  if (isComplete) {
    showCompletionScreen();
    return;
  }

  // Check if batch is future-scheduled or paused: DO NOT auto-load WhatsApp Web!
  const isFutureScheduled = currentBatch.status === BATCH_STATUS.SCHEDULED && new Date(currentBatch.scheduledAt).getTime() > Date.now();
  const isPaused = currentBatch.status === BATCH_STATUS.PAUSED;

  if (!isFutureScheduled && !isPaused && currentBatch.status !== BATCH_STATUS.COMPLETED) {
    // Only auto-load when actively sending (in_progress or overdue)
    loadCurrentRecipientInWhatsApp();
  }
}

/**
 * Renders the empty state with a quick selector of scheduled or paused batches
 */
function renderEmptyState(allBatches = []) {
  emptyStateSection.classList.remove('hidden');
  activeWorkspaceSection.classList.add('hidden');

  availableBatchesList.innerHTML = '';
  const actionable = allBatches.filter((b) => b.status !== BATCH_STATUS.COMPLETED && b.status !== BATCH_STATUS.CANCELLED);

  if (actionable.length === 0) {
    availableBatchesList.innerHTML = '<p style="font-size: 11px; color: var(--text-muted);">No scheduled or paused batches found.</p>';
    return;
  }

  actionable.forEach((b) => {
    const item = document.createElement('div');
    item.className = 'quick-batch-item';
    const total = b.recipients ? b.recipients.length : 0;
    const sent = b.recipients ? b.recipients.filter((r) => r.status === 'sent').length : 0;

    item.innerHTML = `
      <div class="quick-batch-info">
        <h4>${escapeHtml(b.title || 'Untitled Batch')}</h4>
        <span>${sent} / ${total} sent • Status: ${b.status}</span>
      </div>
      <button class="btn btn-primary btn-sm">Start ▶</button>
    `;
    item.addEventListener('click', () => activateBatch(b));
    availableBatchesList.appendChild(item);
  });
}

// ==========================================
// WORKSPACE RENDERING
// ==========================================

function renderWorkspace() {
  if (!currentBatch) return;

  const total = currentBatch.recipients.length;
  const sent = currentBatch.recipients.filter((r) => r.status === RECIPIENT_STATUS.SENT).length;
  const skipped = currentBatch.recipients.filter((r) => r.status === RECIPIENT_STATUS.SKIPPED).length;
  const processed = sent + skipped;
  const remaining = total - processed;

  // Header stats
  batchTitle.textContent = currentBatch.title || 'Untitled Follow-up';

  const isRec = currentBatch.isRecurring && currentBatch.recurringConfig;
  if (isRec) {
    batchStatusBadge.textContent = 'Recurring';
    batchStatusBadge.className = 'status-badge badge-recurring';
    const curCycle = currentBatch.recurringConfig.currentCycle || 1;
    const totCycles = currentBatch.recurringConfig.totalCycles || 1;
    const completedCycles = (currentBatch.recurringConfig.history || []).length;
    statSent.innerHTML = `<strong>Day ${curCycle}</strong> of ${totCycles}`;
    statSkipped.innerHTML = `<strong>${completedCycles}</strong> Done`;
    statRemaining.innerHTML = `<strong>${Math.max(0, totCycles - completedCycles)}</strong> Left`;
    const recPercent = Math.round((completedCycles / totCycles) * 100);
    progressBarFill.style.width = `${recPercent}%`;
    progressPercent.textContent = `${recPercent}%`;
    progressFraction.textContent = `Day ${curCycle} of ${totCycles}`;
  } else {
    batchStatusBadge.textContent = currentBatch.status.replace('_', ' ');
    batchStatusBadge.className = 'status-badge';
    statSent.innerHTML = `<strong>${sent}</strong> Sent`;
    statSkipped.innerHTML = `<strong>${skipped}</strong> Skipped`;
    statRemaining.innerHTML = `<strong>${remaining}</strong> Pending`;
    const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
    progressBarFill.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    progressFraction.textContent = `${processed} / ${total}`;
  }

  // Current recipient details
  const idx = currentBatch.currentIndex || 0;
  const recipient = currentBatch.recipients[idx];

  if (!recipient) {
    if (processed >= total) {
      showCompletionScreen();
    }
    return;
  }

  // Check if batch is future scheduled or paused
  const scheduledWaitingCard = document.getElementById('scheduledWaitingCard');
  const pausedCard = document.getElementById('pausedCard');

  const isFutureScheduled = currentBatch.status === BATCH_STATUS.SCHEDULED && new Date(currentBatch.scheduledAt).getTime() > Date.now();
  const isPaused = currentBatch.status === BATCH_STATUS.PAUSED;

  if (isFutureScheduled) {
    if (recipientCard) recipientCard.classList.add('hidden');
    if (pausedCard) pausedCard.classList.add('hidden');
    if (scheduledWaitingCard) scheduledWaitingCard.classList.remove('hidden');
    if (completionCard) completionCard.classList.add('hidden');

    const d = new Date(currentBatch.scheduledAt);
    document.getElementById('scheduledWaitingTargetTime').textContent = `Scheduled for ${d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;

    const diffMs = d.getTime() - Date.now();
    const diffMins = Math.ceil(diffMs / 60000);
    const countdownBadge = document.getElementById('scheduledWaitingCountdown');
    if (countdownBadge) {
      if (diffMins > 60) {
        const diffHours = Math.round(diffMins / 60);
        countdownBadge.textContent = `Starts in ~${diffHours} hr${diffHours > 1 ? 's' : ''}`;
      } else if (diffMins > 0) {
        countdownBadge.textContent = `Starts in ~${diffMins} min${diffMins > 1 ? 's' : ''}`;
      } else {
        countdownBadge.textContent = 'Due right now';
      }
    }

    const curRec = currentBatch.recipients[idx] || currentBatch.recipients[0];
    if (curRec) {
      document.getElementById('scheduledPreviewName').textContent = curRec.name || 'Recipient';
      document.getElementById('scheduledPreviewPhone').textContent = formatPhoneDisplay(curRec.phone);
      document.getElementById('scheduledPreviewMessage').textContent = curRec.renderedMessage || 'No message prepared';
    }
    return;
  }

  if (isPaused) {
    if (recipientCard) recipientCard.classList.add('hidden');
    if (scheduledWaitingCard) scheduledWaitingCard.classList.add('hidden');
    if (pausedCard) pausedCard.classList.remove('hidden');
    if (completionCard) completionCard.classList.add('hidden');

    const pausedText = document.getElementById('pausedProgressText');
    if (pausedText) {
      pausedText.textContent = `Progress saved: ${processed} of ${total} processed (${remaining} remaining).`;
    }
    return;
  }

  // Active Sending State
  if (scheduledWaitingCard) scheduledWaitingCard.classList.add('hidden');
  if (pausedCard) pausedCard.classList.add('hidden');
  if (completionCard) completionCard.classList.add('hidden');
  if (recipientCard) recipientCard.classList.remove('hidden');

  if (currentBatch.isRecurring && currentBatch.recurringConfig) {
    recipientIndexBadge.textContent = `🔁 Day ${currentBatch.recurringConfig.currentCycle || 1} of ${currentBatch.recurringConfig.totalCycles || 1}`;
  } else {
    recipientIndexBadge.textContent = `Recipient #${idx + 1} of ${total}`;
  }
  recipientStatusPill.textContent = recipient.status.toUpperCase();
  recipientStatusPill.className = `recipient-status-pill status-${recipient.status}`;

  if (inlineEditContainer) inlineEditContainer.classList.add('hidden');
  if (bubbleViewContainer) bubbleViewContainer.classList.remove('hidden');

  recipientName.textContent = recipient.name || 'Unnamed Recipient';
  recipientPhone.textContent = formatPhoneDisplay(recipient.phone);

  // Render dynamic column tags (clean metadata badges, max 5 by default)
  renderRecipientMetadata(recipient);

  // Render message preview
  messageBodyPreview.textContent = recipient.renderedMessage || 'No message prepared';
}

let isTagsExpanded = false;

function renderRecipientMetadata(recipient) {
  const container = document.getElementById('recipientTagsList');
  const toggleBtn = document.getElementById('btnToggleTags');
  if (!container) return;

  container.innerHTML = '';
  if (!recipient || !recipient.customFields) {
    if (toggleBtn) toggleBtn.classList.add('hidden');
    return;
  }

  const ignoredKeys = new Set([
    'name', 'phone', 'fullname', 'mobile', 'id', 'guest_id', 'created_at',
    'utm_source', 'utm_medium', 'utm_campaign', 'referrer', 'referred_by',
    'qr_code_url', 'amount_tax', 'amount_discount', 'currency', 'eth_address',
    'solana_address', 'approval_status', 'checked_in_at'
  ]);

  const cleanEntries = [];
  for (const [rawKey, rawVal] of Object.entries(recipient.customFields)) {
    const k = rawKey.toLowerCase().trim();
    if (ignoredKeys.has(k)) continue;
    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') continue;

    // Shorten long prompt questions to clean concise label
    let label = rawKey;
    if (label.length > 20) {
      if (k.includes('company')) label = 'Company';
      else if (k.includes('role')) label = 'Role';
      else if (k.includes('linkedin')) label = 'LinkedIn';
      else if (k.includes('product') || k.includes('building')) label = 'Product';
      else if (k.includes('feedback')) label = 'Feedback';
      else label = label.slice(0, 18) + '…';
    }

    cleanEntries.push({ key: label, val: String(rawVal).trim() });
  }

  const MAX_DEFAULT = 5;
  const visibleEntries = isTagsExpanded ? cleanEntries : cleanEntries.slice(0, MAX_DEFAULT);

  visibleEntries.forEach(({ key, val }) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.title = `${key}: ${val}`;
    chip.textContent = `${key}: ${val}`;
    container.appendChild(chip);
  });

  if (toggleBtn) {
    if (cleanEntries.length > MAX_DEFAULT) {
      toggleBtn.classList.remove('hidden');
      toggleBtn.textContent = isTagsExpanded
        ? '▴ Show less'
        : `+ ${cleanEntries.length - MAX_DEFAULT} more fields ▾`;
      toggleBtn.onclick = () => {
        isTagsExpanded = !isTagsExpanded;
        renderRecipientMetadata(recipient);
      };
    } else {
      toggleBtn.classList.add('hidden');
    }
  }
}

function showCompletionScreen() {
  recipientCard.classList.add('hidden');
  if (scheduledWaitingCard) scheduledWaitingCard.classList.add('hidden');
  if (pausedCard) pausedCard.classList.add('hidden');
  completionCard.classList.remove('hidden');

  const total = currentBatch ? currentBatch.recipients.length : 0;
  const sent = currentBatch ? currentBatch.recipients.filter((r) => r.status === RECIPIENT_STATUS.SENT).length : 0;
  const skipped = currentBatch ? currentBatch.recipients.filter((r) => r.status === RECIPIENT_STATUS.SKIPPED).length : 0;

  metricSentCount.textContent = sent;
  metricSkippedCount.textContent = skipped;
  metricTotalCount.textContent = total;

  const completionHeading = completionCard.querySelector('h2');
  const completionIcon = completionCard.querySelector('.confetti-icon');

  if (total === 1) {
    const rName = currentBatch.recipients[0]?.name || 'Contact';
    if (skipped === 1) {
      if (completionIcon) completionIcon.textContent = '⏭️';
      if (completionHeading) completionHeading.textContent = 'Follow-up Skipped';
      completionSummaryText.textContent = `Follow-up with ${rName} was skipped. WhatsApp Web tab closed.`;
    } else {
      if (completionIcon) completionIcon.textContent = '✅';
      if (completionHeading) completionHeading.textContent = 'Follow-up Sent!';
      completionSummaryText.textContent = `Follow-up with ${rName} completed successfully!`;
    }
  } else {
    if (completionIcon) completionIcon.textContent = '🎉';
    if (completionHeading) completionHeading.textContent = 'Batch Completed!';
    completionSummaryText.textContent = `Batch ended! Processed: ${sent} sent, ${skipped} skipped (out of ${total} total).`;
  }

  // Trigger celebration chime
  SoundPlayer.playChime(currentSettings ? currentSettings.soundVolume : 0.8);
}

// ==========================================
// ACTIONS & CONTROLS
// ==========================================

async function loadCurrentRecipientInWhatsApp() {
  if (!currentBatch) return;
  const idx = currentBatch.currentIndex || 0;
  const recipient = currentBatch.recipients[idx];
  if (!recipient) return;

  await WhatsAppOrchestrator.loadContact(recipient.phone, recipient.renderedMessage);
}

async function handleMarkSent() {
  if (isPacing || !currentBatch) return;

  const idx = currentBatch.currentIndex || 0;
  const currentRecipient = currentBatch.recipients ? currentBatch.recipients[idx] : null;

  await StorageService.updateBatchRecipient(currentBatch.id, idx, {
    status: RECIPIENT_STATUS.SENT,
    sentAt: new Date().toISOString()
  });

  // Auto-snooze if enabled (Feature 2: Awaiting Reply Smart Snooze)
  const chkSnooze = document.getElementById('chkAutoSnoozeAfterSend');
  if (chkSnooze && chkSnooze.checked && currentRecipient) {
    const hours = parseInt(document.getElementById('selectSidepanelSnoozeHours')?.value, 10) || 48;
    const now = new Date();
    const dueAt = new Date(now.getTime() + hours * 3600000).toISOString();
    await StorageService.saveSnooze({
      contactName: currentRecipient.name || (currentRecipient.phone ? `+${currentRecipient.phone}` : 'Contact'),
      phone: currentRecipient.phone || '',
      cleanIdentifier: currentRecipient.phone || (currentRecipient.name || '').toLowerCase(),
      snoozedAt: now.toISOString(),
      dueAt: dueAt,
      durationHours: hours,
      lastMessageSnippet: currentRecipient.renderedMessage || '',
      status: SNOOZE_STATUS.AWAITING
    }).catch((err) => console.warn('[PingLater] Could not auto-snooze:', err));
  }

  // Google Sheets 2-Way Writeback (Feature 4)
  if (currentBatch.sheetSync && currentBatch.sheetSync.twoWaySyncEnabled && currentBatch.sheetSync.webhookUrl && currentRecipient) {
    writeBackToGoogleSheet(currentBatch.sheetSync.webhookUrl, {
      phone: currentRecipient.phone,
      name: currentRecipient.name,
      status: 'Sent',
      sentAt: new Date().toLocaleString()
    }).catch((err) => console.warn('[PingLater] Sheet writeback error:', err));
  }

  // Cadence Step Advancement (Feature 5: Multi-Step Sequences)
  if (currentRecipient && currentRecipient.cadenceEnrollmentId) {
    try {
      const enrollments = await StorageService.getCadenceEnrollments();
      const enr = enrollments.find((e) => e.id === currentRecipient.cadenceEnrollmentId);
      if (enr) {
        const blueprints = await StorageService.getCadenceBlueprints();
        const bp = blueprints.find((b) => b.id === enr.cadenceId);
        const updated = recordStepSent(enr, bp, { message: currentRecipient.renderedMessage });
        await StorageService.saveCadenceEnrollment(updated);

        if (updated.nextStepDueAt && updated.status === 'awaiting') {
          if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
            chrome.runtime.sendMessage({
              type: 'SCHEDULE_CADENCE_ALARM',
              enrollmentId: updated.id,
              dueAt: updated.nextStepDueAt
            }).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.warn('[PingLater] Error advancing cadence enrollment in sidepanel:', err);
    }
  }

  // Reload batch state
  currentBatch = await StorageService.getBatchById(currentBatch.id);

  if (currentBatch.isRecurring) {
    await handleRecurringStep('sent');
    return;
  }

  // Advance to next pending recipient
  await advanceNextRecipient();
}

async function handleSkip() {
  if (isPacing || !currentBatch) return;

  const idx = currentBatch.currentIndex || 0;
  const skippedRecipient = currentBatch.recipients ? currentBatch.recipients[idx] : null;

  await StorageService.updateBatchRecipient(currentBatch.id, idx, {
    status: RECIPIENT_STATUS.SKIPPED,
    skipReason: 'Manually skipped by user',
    skippedAt: new Date().toISOString()
  });

  // Google Sheets 2-Way Writeback for Skipped (Feature 4)
  if (currentBatch.sheetSync && currentBatch.sheetSync.twoWaySyncEnabled && currentBatch.sheetSync.webhookUrl && skippedRecipient) {
    writeBackToGoogleSheet(currentBatch.sheetSync.webhookUrl, {
      phone: skippedRecipient.phone,
      name: skippedRecipient.name,
      status: 'Skipped',
      sentAt: new Date().toLocaleString()
    }).catch((err) => console.warn('[PingLater] Sheet writeback error:', err));
  }

  currentBatch = await StorageService.getBatchById(currentBatch.id);

  if (currentBatch.isRecurring) {
    await handleRecurringStep('skipped');
    return;
  }

  const isOneToOne = currentBatch.type === 'single' || 
                     (currentBatch.recipients && currentBatch.recipients.length === 1);

  if (isOneToOne) {
    // 1-on-1 follow-up skipped: automatically wipe text from WhatsApp composer and close tab
    await WhatsAppOrchestrator.closeWhatsAppTabs().catch(() => {});
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'CLOSE_WHATSAPP_TABS' }).catch(() => {});
    }
  }

  await advanceNextRecipient();
}

/**
 * Handles stepping through a recurring daily/weekly schedule.
 */
async function handleRecurringStep(action = 'sent') {
  clearPacing();
  const cfg = currentBatch.recurringConfig || {};
  const currentCycle = cfg.currentCycle || 1;
  const totalCycles = cfg.totalCycles || 1;

  // 1. Record today's history entry
  const history = cfg.history || [];
  history.push({
    cycle: currentCycle,
    date: new Date().toISOString().slice(0, 10),
    action,
    timestamp: new Date().toISOString()
  });

  // 2. Wipe text from WhatsApp composer and close WhatsApp Web tab!
  await WhatsAppOrchestrator.closeWhatsAppTabs().catch(() => {});
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'CLOSE_WHATSAPP_TABS' }).catch(() => {});
  }

  // 3. Calculate next occurrence
  const nextDate = calculateNextRecurringDate(cfg, new Date());

  // 4. If next occurrence is valid and we haven't reached totalCycles:
  if (nextDate && currentCycle < totalCycles) {
    const nextCycle = currentCycle + 1;
    const nextScheduledAt = nextDate.toISOString();

    // Reset recipient status for next day
    const updatedRecipients = (currentBatch.recipients || []).map((r) => ({
      ...r,
      status: RECIPIENT_STATUS.PENDING,
      sentAt: null,
      skippedAt: null
    }));

    await StorageService.updateBatch(currentBatch.id, {
      status: BATCH_STATUS.SCHEDULED,
      scheduledAt: nextScheduledAt,
      currentIndex: 0,
      recipients: updatedRecipients,
      recurringConfig: {
        ...cfg,
        currentCycle: nextCycle,
        history
      }
    });

    currentBatch = await StorageService.getBatchById(currentBatch.id);

    // Register next Chrome alarm via background
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'SCHEDULE_BATCH',
        batchId: currentBatch.id,
        scheduledAt: nextScheduledAt
      });
      chrome.runtime.sendMessage({
        type: 'REFRESH_BADGE'
      });
    }

    showRecurringCycleScreen(currentCycle, totalCycles, nextDate, action);
  } else {
    // Finished all occurrences or reached end date
    await StorageService.updateBatch(currentBatch.id, {
      status: BATCH_STATUS.COMPLETED,
      completedAt: new Date().toISOString(),
      recurringConfig: {
        ...cfg,
        history
      }
    });

    currentBatch = await StorageService.getBatchById(currentBatch.id);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'BATCH_COMPLETED',
        batchId: currentBatch.id
      });
    }

    showCompletionScreen();
  }
}

function showRecurringCycleScreen(cycle, total, nextDate, action) {
  recipientCard.classList.add('hidden');
  const scheduledWaitingCard = document.getElementById('scheduledWaitingCard');
  const pausedCard = document.getElementById('pausedCard');
  if (scheduledWaitingCard) scheduledWaitingCard.classList.add('hidden');
  if (pausedCard) pausedCard.classList.add('hidden');
  completionCard.classList.remove('hidden');

  metricSentCount.textContent = cycle;
  metricSkippedCount.textContent = Math.max(0, total - cycle);
  metricTotalCount.textContent = total;

  const completionHeading = completionCard.querySelector('h2');
  const completionIcon = completionCard.querySelector('.confetti-icon');

  if (completionIcon) completionIcon.textContent = action === 'sent' ? '🔁' : '⏭️';
  if (completionHeading) completionHeading.textContent = `Day ${cycle} of ${total} ${action === 'sent' ? 'Sent' : 'Skipped'}`;

  const nextStr = nextDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  completionSummaryText.textContent = `Progress saved! Next recurring follow-up is scheduled for ${nextStr}. WhatsApp Web tab closed.`;

  SoundPlayer.playChime(currentSettings ? currentSettings.soundVolume : 0.8);
}

function handlePrevious() {
  if (isPacing || !currentBatch) return;
  if (currentBatch.currentIndex > 0) {
    currentBatch.currentIndex--;
    StorageService.updateBatch(currentBatch.id, { currentIndex: currentBatch.currentIndex });
    renderWorkspace();
    loadCurrentRecipientInWhatsApp();
  }
}

async function handlePauseBatch() {
  if (!currentBatch) return;
  clearPacing();
  await StorageService.updateBatch(currentBatch.id, { status: BATCH_STATUS.PAUSED });
  currentBatch.status = BATCH_STATUS.PAUSED;
  renderWorkspace();
  batchStatusBadge.textContent = 'Paused';
}

async function handleEndBatch() {
  if (!currentBatch) return;

  // Clear pacing timer immediately so it doesn't fire in the background
  clearPacing();

  const total = currentBatch.recipients ? currentBatch.recipients.length : 0;
  const sent = currentBatch.recipients ? currentBatch.recipients.filter((r) => r.status === RECIPIENT_STATUS.SENT).length : 0;
  const skipped = currentBatch.recipients ? currentBatch.recipients.filter((r) => r.status === RECIPIENT_STATUS.SKIPPED).length : 0;
  const remaining = total - (sent + skipped);

  const confirmMsg = remaining > 0
    ? `End and complete this batch now?\n\n• ${sent} sent\n• ${skipped} skipped\n• ${remaining} pending remaining\n\nYour progress will be saved.`
    : `End and complete this batch job now?`;

  if (!confirm(confirmMsg)) return;

  // Mark all remaining pending recipients as skipped/ended
  if (currentBatch.recipients) {
    currentBatch.recipients.forEach((r) => {
      if (r.status === RECIPIENT_STATUS.PENDING) {
        r.status = RECIPIENT_STATUS.SKIPPED;
        r.skipReason = 'Batch ended early by user';
      }
    });
  }

  // Cancel any active alarms for this batch
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({
      type: 'CANCEL_BATCH_ALARM',
      batchId: currentBatch.id
    });
  }

  // Update batch in storage as completed
  await StorageService.updateBatch(currentBatch.id, {
    status: BATCH_STATUS.COMPLETED,
    recipients: currentBatch.recipients,
    completedAt: new Date().toISOString()
  });

  currentBatch.status = BATCH_STATUS.COMPLETED;
  showCompletionScreen();

  // Close WhatsApp Web tabs if active
  await WhatsAppOrchestrator.closeWhatsAppTabs().catch(() => {});
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'CLOSE_WHATSAPP_TABS' }).catch(() => {});
  }

  // Notify dashboard or other views that batch ended
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({
      type: 'BATCH_COMPLETED',
      batchId: currentBatch.id
    });
  }
}

async function advanceNextRecipient() {
  const total = currentBatch.recipients.length;

  // Find next pending recipient starting from current index + 1
  let nextIdx = -1;
  for (let i = currentBatch.currentIndex + 1; i < total; i++) {
    if (currentBatch.recipients[i].status === RECIPIENT_STATUS.PENDING) {
      nextIdx = i;
      break;
    }
  }

  // If no pending found forward, search from beginning
  if (nextIdx === -1) {
    for (let i = 0; i < total; i++) {
      if (currentBatch.recipients[i].status === RECIPIENT_STATUS.PENDING) {
        nextIdx = i;
        break;
      }
    }
  }

  if (nextIdx === -1) {
    // All done! Mark batch completed in storage
    currentBatch.status = BATCH_STATUS.COMPLETED;
    await StorageService.updateBatch(currentBatch.id, {
      status: BATCH_STATUS.COMPLETED,
      completedAt: new Date().toISOString()
    });

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'BATCH_COMPLETED',
        batchId: currentBatch.id
      });
    }

    const isOneToOne = currentBatch.type === 'single' || (currentBatch.recipients && currentBatch.recipients.length === 1);
    if (isOneToOne) {
      await WhatsAppOrchestrator.closeWhatsAppTabs().catch(() => {});
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'CLOSE_WHATSAPP_TABS' }).catch(() => {});
      }
    }

    renderWorkspace();
    showCompletionScreen();
    return;
  }

  currentBatch.currentIndex = nextIdx;
  StorageService.updateBatch(currentBatch.id, { currentIndex: nextIdx });

  // Check if safe pacing is enabled (default: 10 seconds)
  const pacingSeconds = togglePacingDelay.checked ? (currentSettings.defaultPacingSeconds || 10) : 0;
  if (pacingSeconds > 0) {
    startPacingCountdown(pacingSeconds);
  } else {
    finishPacingAndLoadNext();
  }
}

// ==========================================
// PACING COUNTDOWN CONTROLLER
// ==========================================

function startPacingCountdown(seconds) {
  isPacing = true;
  pacingOverlay.classList.remove('hidden');
  let remaining = seconds;
  pacingSecondsText.textContent = remaining;

  clearInterval(pacingInterval);
  pacingInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearPacing();
      finishPacingAndLoadNext();
    } else {
      pacingSecondsText.textContent = remaining;
    }
  }, 1000);
}

function clearPacing() {
  clearInterval(pacingInterval);
  isPacing = false;
  pacingOverlay.classList.add('hidden');
}

async function finishPacingAndLoadNext() {
  clearPacing();
  renderWorkspace();

  // Play audio chime
  if (currentSettings && currentSettings.soundEnabled) {
    SoundPlayer.playChime(currentSettings.soundVolume || 0.8);
  }

  // Auto-load in WhatsApp Web
  await loadCurrentRecipientInWhatsApp();
}

// ==========================================
// CSV EXPORT REPORT
// ==========================================

function exportCSVReport() {
  if (!currentBatch || !currentBatch.recipients) return;

  const rows = [];
  const headers = ['Row', 'Name', 'Phone', 'Status', 'SentAt', 'SkippedAt'];

  // Discover any extra custom field headers
  const extraHeaders = new Set();
  currentBatch.recipients.forEach((r) => {
    if (r.customFields) {
      Object.keys(r.customFields).forEach((k) => {
        if (!['name', 'phone'].includes(k.toLowerCase())) extraHeaders.add(k);
      });
    }
  });
  const allHeaders = [...headers, ...Array.from(extraHeaders)];
  rows.push(allHeaders.map(escapeCSVCell).join(','));

  currentBatch.recipients.forEach((r, idx) => {
    const row = [
      idx + 1,
      r.name || '',
      r.phone || '',
      r.status || 'pending',
      r.sentAt || '',
      r.skippedAt || ''
    ];
    extraHeaders.forEach((eh) => {
      row.push(r.customFields && r.customFields[eh] ? r.customFields[eh] : '');
    });
    rows.push(row.map(escapeCSVCell).join(','));
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n'));
  const link = document.createElement('a');
  link.setAttribute('href', csvContent);
  link.setAttribute('download', `PingLater_Report_${currentBatch.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================
// EVENT LISTENERS
// ==========================================

function setupEventListeners() {
  btnMarkSent.addEventListener('click', handleMarkSent);
  btnSkip.addEventListener('click', handleSkip);
  btnPrevRecipient.addEventListener('click', handlePrevious);
  btnPauseBatch.addEventListener('click', handlePauseBatch);
  btnEndBatch?.addEventListener('click', handleEndBatch);
  btnHeaderEndJob?.addEventListener('click', handleEndBatch);
  btnEndBatchFromPaused?.addEventListener('click', handleEndBatch);
  btnCancelScheduledJob?.addEventListener('click', handleEndBatch);
  btnLoadInWhatsApp.addEventListener('click', loadCurrentRecipientInWhatsApp);
  btnSkipPacing.addEventListener('click', () => {
    clearPacing();
    finishPacingAndLoadNext();
  });

  btnCopyMessage.addEventListener('click', () => {
    if (!messageBodyPreview.textContent) return;
    navigator.clipboard.writeText(messageBodyPreview.textContent).then(() => {
      copyBtnLabel.textContent = 'Copied! ✓';
      setTimeout(() => (copyBtnLabel.textContent = 'Copy'), 2000);
    });
  });

  // Inline Message Editing handlers
  btnEditRecipientMessage?.addEventListener('click', () => {
    if (!currentBatch) return;
    const idx = currentBatch.currentIndex || 0;
    const recipient = currentBatch.recipients[idx];
    if (!recipient) return;

    inlineMessageTextarea.value = recipient.renderedMessage || '';
    bubbleViewContainer.classList.add('hidden');
    inlineEditContainer.classList.remove('hidden');
    inlineMessageTextarea.focus();
  });

  btnCancelInlineEdit?.addEventListener('click', () => {
    inlineEditContainer.classList.add('hidden');
    bubbleViewContainer.classList.remove('hidden');
  });

  btnSaveInlineEdit?.addEventListener('click', async () => {
    if (!currentBatch) return;
    const idx = currentBatch.currentIndex || 0;
    const recipient = currentBatch.recipients[idx];
    if (!recipient) return;

    const newText = inlineMessageTextarea.value.trim();
    recipient.renderedMessage = newText;
    messageBodyPreview.textContent = newText;

    inlineEditContainer.classList.add('hidden');
    bubbleViewContainer.classList.remove('hidden');

    // Persist update in batch storage
    await StorageService.updateBatchRecipient(currentBatch.id, idx, {
      renderedMessage: newText
    });

    // Directly load the edited text into active WhatsApp Web tab!
    await WhatsAppOrchestrator.loadContact(recipient.phone, newText);
  });

  btnExportReport.addEventListener('click', exportCSVReport);

  // Resume or Bypass Schedule Actions
  document.getElementById('btnStartScheduledNow')?.addEventListener('click', async () => {
    if (!currentBatch) return;
    await StorageService.updateBatch(currentBatch.id, { status: BATCH_STATUS.IN_PROGRESS });
    currentBatch.status = BATCH_STATUS.IN_PROGRESS;
    renderWorkspace();
    loadCurrentRecipientInWhatsApp();
  });

  document.getElementById('btnResumeBatch')?.addEventListener('click', async () => {
    if (!currentBatch) return;
    await StorageService.updateBatch(currentBatch.id, { status: BATCH_STATUS.IN_PROGRESS });
    currentBatch.status = BATCH_STATUS.IN_PROGRESS;
    renderWorkspace();
    loadCurrentRecipientInWhatsApp();
  });

  document.getElementById('btnOpenDashboardFromScheduled')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
  });

  document.getElementById('btnOpenDashboardFromPaused')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
  });

  btnOpenDashboard.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
  });

  btnCreateNewBatchEmpty.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
  });

  btnBackToDashboardFromComplete.addEventListener('click', async () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    currentBatch = null;
    const allBatches = await StorageService.getBatches();
    renderEmptyState(allBatches);
  });

  btnTestSound.addEventListener('click', () => {
    SoundPlayer.playChime(currentSettings ? currentSettings.soundVolume : 0.8);
  });

  // Keyboard shortcut listener: Spacebar to Mark Sent
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
      if (!isInput) {
        e.preventDefault();
        handleMarkSent();
      }
    }
  });

  // Listen for background messages (e.g. LOAD_BATCH_IN_SIDEPANEL)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'LOAD_BATCH_IN_SIDEPANEL' && msg.batchId) {
        loadActiveOrTargetBatch(msg.batchId);
      }
    });
  }

  // Real-time synchronization when batches change in storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.pinglater_batches) {
        loadActiveOrTargetBatch();
      }
    });
  }
}

// ==========================================
// UTILITY HELPERS
// ==========================================

function formatPhoneDisplay(phone) {
  const p = String(phone || '').replace(/\D/g, '');
  if (p.length === 12 && p.startsWith('91')) {
    return `+91 ${p.substring(2, 7)} ${p.substring(7)}`;
  }
  if (p.length === 11 && p.startsWith('1')) {
    return `+1 (${p.substring(1, 4)}) ${p.substring(4, 7)}-${p.substring(7)}`;
  }
  return `+${p}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeCSVCell(val) {
  const s = String(val === undefined || val === null ? '' : val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
