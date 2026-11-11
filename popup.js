/**
 * PingLater - Extension Toolbar Popup Controller (Module 8)
 * Lightweight quick menu for instant status overview,
 * launching the side panel, and fast shortcuts.
 */

import { StorageService, BATCH_STATUS, RECIPIENT_STATUS } from './utils/storage.js';
import { normalizePhoneNumber } from './utils/normalizer.js';
import { renderTemplate } from './utils/template.js';
import { SoundPlayer } from './utils/audio.js';

let activeBatch = null;

document.addEventListener('DOMContentLoaded', async () => {
  await StorageService.initDefaults();
  await loadPopupStatus();
  setupEventListeners();
});

async function loadPopupStatus() {
  const batches = await StorageService.getBatches();
  const settings = await StorageService.getSettings();

  const statusBadge = document.getElementById('popupStatusBadge');
  const activeCard = document.getElementById('activeBatchCard');
  const idleCard = document.getElementById('idleStateCard');
  const idleTitle = document.getElementById('idleHeaderTitle');
  const idleSubtext = document.getElementById('idleSubtext');

  // Look for active / overdue batch
  activeBatch = batches.find((b) => b.status === BATCH_STATUS.OVERDUE) ||
                batches.find((b) => b.status === BATCH_STATUS.IN_PROGRESS) ||
                batches.find((b) => b.status === BATCH_STATUS.SCHEDULED && new Date(b.scheduledAt).getTime() <= Date.now());

  if (activeBatch) {
    statusBadge.textContent = activeBatch.status.toUpperCase();
    statusBadge.className = `status-indicator ${activeBatch.status === BATCH_STATUS.OVERDUE ? 'status-overdue' : 'status-active'}`;

    activeCard.classList.remove('hidden');
    idleCard.classList.add('hidden');

    document.getElementById('popupBatchTitle').textContent = activeBatch.title;
    document.getElementById('popupBatchStatus').textContent = activeBatch.status.replace('_', ' ');

    const total = activeBatch.recipients ? activeBatch.recipients.length : 0;
    const sent = activeBatch.recipients ? activeBatch.recipients.filter((r) => r.status === RECIPIENT_STATUS.SENT).length : 0;
    const skipped = activeBatch.recipients ? activeBatch.recipients.filter((r) => r.status === RECIPIENT_STATUS.SKIPPED).length : 0;
    const processed = sent + skipped;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

    document.getElementById('popupProgressFill').style.width = `${pct}%`;
    document.getElementById('popupCounts').textContent = `${processed} of ${total} processed`;
    document.getElementById('popupPercent').textContent = `${pct}%`;
  } else {
    activeCard.classList.add('hidden');
    idleCard.classList.remove('hidden');
    statusBadge.textContent = 'READY';
    statusBadge.className = 'status-indicator status-idle';

    // Check for next upcoming batch
    const upcoming = batches
      .filter((b) => b.status === BATCH_STATUS.SCHEDULED)
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];

    if (upcoming) {
      idleTitle.textContent = `Next: ${upcoming.title}`;
      idleSubtext.textContent = `Scheduled for ${new Date(upcoming.scheduledAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`;
    } else {
      idleTitle.textContent = 'All follow-ups caught up';
      idleSubtext.textContent = 'No batches currently due. Ready to plan your next outreach?';
    }
  }
}

function setupEventListeners() {
  // Launch Side Panel with active batch
  document.getElementById('btnLaunchActiveInSidepanel')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'OPEN_WORKSPACE',
      batchId: activeBatch ? activeBatch.id : undefined
    });
    window.close();
  });

  // Open Dashboard
  document.getElementById('btnPopupDashboard')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    window.close();
  });

  // New Batch Campaign
  document.getElementById('btnPopupNewBatch')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    window.close();
  });

  // Toggle Quick 1-to-1 Drawer
  const drawer = document.getElementById('quickPingDrawer');
  document.getElementById('btnPopupQuickPing')?.addEventListener('click', () => {
    drawer.classList.toggle('hidden');
    if (!drawer.classList.contains('hidden')) {
      document.getElementById('popupSingleName').focus();
    }
  });

  document.getElementById('btnCloseDrawer')?.addEventListener('click', () => {
    drawer.classList.add('hidden');
  });

  // Quick 1-to-1 save
  document.getElementById('btnPopupSaveSingle')?.addEventListener('click', async () => {
    const name = document.getElementById('popupSingleName').value.trim();
    const phone = document.getElementById('popupSinglePhone').value.trim();
    const msg = document.getElementById('popupSingleMessage').value.trim();

    if (!name || !phone || !msg) {
      alert('Please fill name, phone, and message.');
      return;
    }

    const settings = await StorageService.getSettings();
    const norm = normalizePhoneNumber(phone, settings.defaultCountryCode || '91');
    if (!norm.isValid) {
      alert(`Invalid phone number: ${norm.error}`);
      return;
    }

    // Default to tomorrow 10 AM
    const defDate = new Date();
    defDate.setDate(defDate.getDate() + 1);
    defDate.setHours(10, 0, 0, 0);

    const rendered = renderTemplate(msg, { name, phone: norm.normalized });
    const batch = {
      title: `Follow-up with ${name}`,
      type: 'single',
      templateBody: msg,
      recipients: [{
        id: `rec_single_${Date.now()}`,
        name,
        phone: norm.normalized,
        renderedMessage: rendered,
        status: RECIPIENT_STATUS.PENDING,
        customFields: { name, phone: norm.normalized }
      }],
      currentIndex: 0,
      scheduledAt: defDate.toISOString(),
      pacingSeconds: 0,
      status: BATCH_STATUS.SCHEDULED
    };

    const saved = await StorageService.saveBatch(batch);
    chrome.runtime.sendMessage({
      type: 'SCHEDULE_BATCH',
      batchId: saved.id,
      scheduledAt: saved.scheduledAt
    });

    drawer.classList.add('hidden');
    loadPopupStatus();
  });

  // Test Chime
  document.getElementById('btnPopupTestChime')?.addEventListener('click', () => {
    SoundPlayer.playChime(0.8);
  });
}
