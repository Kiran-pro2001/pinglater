/**
 * PingLater - Background Service Worker (Module 4)
 * Handles Chrome alarms, overdue detection, system notifications,
 * toolbar badge management, and side panel opening.
 */

import { StorageService, BATCH_STATUS, SNOOZE_STATUS } from './utils/storage.js';

const WATCHDOG_ALARM_NAME = 'pinglater_watchdog';

// ==========================================
// LIFECYCLE HOOKS
// ==========================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[PingLater] Extension installed/updated:', details.reason);
  await StorageService.initDefaults();

  // Configure Side Panel behavior: open side panel on toolbar action click
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn('[PingLater] Could not set openPanelOnActionClick:', err);
    });
  }

  // Set up periodic watchdog to detect overdue batches (every 5 minutes)
  chrome.alarms.create(WATCHDOG_ALARM_NAME, { periodInMinutes: 5 });

  await checkOverdueAndRefreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[PingLater] Chrome browser startup');
  await checkOverdueAndRefreshBadge();
});

// ==========================================
// TOOLBAR ACTION CLICK -> OPEN REAL SIDE PANEL
// ==========================================
chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (e) {
      console.warn('[PingLater] Error opening side panel on click:', e);
    }
  }
});

// ==========================================
// ALARM LISTENER
// ==========================================

chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log('[PingLater] Alarm triggered:', alarm.name);

  if (alarm.name === WATCHDOG_ALARM_NAME) {
    await checkOverdueAndRefreshBadge();
    return;
  }

  if (alarm.name.startsWith('batch_')) {
    const batchId = alarm.name;
    await triggerBatchDue(batchId);
    return;
  }

  if (alarm.name.startsWith('snooze_')) {
    const snoozeId = alarm.name;
    await triggerSnoozeDue(snoozeId);
    return;
  }

  if (alarm.name.startsWith('cadence_')) {
    const enrollmentId = alarm.name.replace('cadence_', '');
    await triggerCadenceDue(enrollmentId);
    return;
  }
});

/**
 * Handles a cadence step that has become due for sending (Feature 5).
 */
async function triggerCadenceDue(enrollmentId) {
  const { all } = await StorageService.refreshDueCadenceEnrollments();
  const enr = all.find((e) => e.id === enrollmentId);
  if (!enr || enr.status !== 'due') return;

  const contact = enr.contactName || (enr.phone ? `+${enr.phone}` : 'Contact');
  const stepNum = (enr.currentStepIndex || 0) + 1;

  chrome.notifications.create(`notif_cadence_${enrollmentId}`, {
    type: 'basic',
    iconUrl: 'assets/icons/icon128.png',
    title: `🎯 Follow-Up Due: ${contact}`,
    message: `Step ${stepNum} of ${enr.totalSteps} (${enr.cadenceName}) is ready to review and send.`,
    priority: 2,
    requireInteraction: true
  });

  await checkOverdueAndRefreshBadge();
}

/**
 * Handles a snoozed chat that expired without receiving a reply (Feature 2).
 */
async function triggerSnoozeDue(snoozeId) {
  const snooze = await StorageService.getSnoozeById(snoozeId);
  if (!snooze || snooze.status !== SNOOZE_STATUS.AWAITING) {
    return;
  }

  // Update status to DUE
  await StorageService.updateSnooze(snoozeId, {
    status: SNOOZE_STATUS.DUE
  });

  const contact = snooze.contactName || (snooze.phone ? `+${snooze.phone}` : 'Contact');
  const hours = snooze.durationHours || 48;

  chrome.notifications.create(`notif_snooze_${snoozeId}`, {
    type: 'basic',
    iconUrl: 'assets/icons/icon128.png',
    title: `⏰ No Reply: ${contact}`,
    message: `${contact} hasn't replied to your message after ${hours}h. Click to open chat and follow up.`,
    priority: 2,
    requireInteraction: true
  });

  await checkOverdueAndRefreshBadge();
}

/**
 * Handles a batch whose scheduled time has arrived.
 */
async function triggerBatchDue(batchId) {
  const batch = await StorageService.getBatchById(batchId);
  if (!batch || batch.status === BATCH_STATUS.COMPLETED || batch.status === BATCH_STATUS.CANCELLED) {
    return;
  }

  // Mark status as in_progress / due
  await StorageService.updateBatch(batchId, {
    status: BATCH_STATUS.IN_PROGRESS
  });

  const total = batch.recipients ? batch.recipients.length : 0;
  const remaining = batch.recipients ? batch.recipients.filter((r) => r.status === 'pending').length : 0;

  // Show rich Chrome system notification
  const notificationId = `notif_${batchId}`;
  const isRec = batch.isRecurring && batch.recurringConfig;
  const titleText = isRec
    ? `🔔 PingLater: ${batch.title} (Day ${batch.recurringConfig.currentCycle || 1} of ${batch.recurringConfig.totalCycles || '?'})`
    : `🔔 PingLater: "${batch.title}" is ready!`;

  const msgText = isRec
    ? `Time for your scheduled WhatsApp check-in. Click to open workspace.`
    : `${remaining} follow-up(s) ready to review & send. Click to open sending workspace.`;

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'assets/icons/icon128.png',
    title: titleText,
    message: msgText,
    priority: 2,
    requireInteraction: true
  });

  await checkOverdueAndRefreshBadge();
}

// ==========================================
// NOTIFICATION CLICKS
// ==========================================

chrome.notifications.onClicked.addListener(async (notificationId) => {
  console.log('[PingLater] Notification clicked:', notificationId);
  chrome.notifications.clear(notificationId);

  // Handle Snooze due notifications (Feature 2)
  if (notificationId.startsWith('notif_snooze_')) {
    const targetSnoozeId = notificationId.replace('notif_snooze_', '');
    const snooze = await StorageService.getSnoozeById(targetSnoozeId);
    if (snooze && snooze.phone) {
      const cleanPhone = String(snooze.phone).replace(/\D/g, '');
      const url = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
      const waTabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
      if (waTabs.length > 0) {
        await chrome.tabs.update(waTabs[0].id, { url, active: true });
      } else {
        await chrome.tabs.create({ url, active: true });
      }
    } else {
      await openSendingWorkspace();
    }
    return;
  }

  // Extract batchId if present
  let targetBatchId = null;
  if (notificationId.startsWith('notif_batch_')) {
    targetBatchId = notificationId.replace('notif_', '');
  }

  // Open Side Panel and activate/open WhatsApp Web
  await openSendingWorkspace(targetBatchId);
});

/**
 * Opens Side Panel and ensures WhatsApp Web is open/focused in the current window.
 */
async function openSendingWorkspace(batchId = null) {
  try {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const windowId = currentTab ? currentTab.windowId : undefined;

    // Open side panel if API is available
    if (chrome.sidePanel && chrome.sidePanel.open && windowId) {
      await chrome.sidePanel.open({ windowId });
    }

    // Check if WhatsApp Web tab is already open
    const waTabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
    if (waTabs.length > 0) {
      await chrome.tabs.update(waTabs[0].id, { active: true });
    } else {
      // Open WhatsApp Web in a tab
      await chrome.tabs.create({ url: 'https://web.whatsapp.com', active: true });
    }

    // Notify sidepanel about the active batch if specified
    if (batchId) {
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'LOAD_BATCH_IN_SIDEPANEL', batchId }).catch(() => {});
      }, 500);
    }
  } catch (err) {
    console.error('[PingLater] Failed to open workspace:', err);
  }
}

// ==========================================
// OVERDUE DETECTOR & BADGE MANAGER
// ==========================================

export async function checkOverdueAndRefreshBadge() {
  const batches = await StorageService.getBatches();
  const snoozes = await StorageService.getSnoozes();
  const now = Date.now();

  let overdueCount = 0;
  let activePendingCount = 0;
  let dueSnoozeCount = 0;

  for (const b of batches) {
    if (b.status === BATCH_STATUS.COMPLETED || b.status === BATCH_STATUS.CANCELLED) {
      continue;
    }

    const scheduledTime = new Date(b.scheduledAt).getTime();
    const isPast = scheduledTime <= now;

    if (b.status === BATCH_STATUS.SCHEDULED && isPast) {
      // Has passed scheduled time: mark as overdue
      await StorageService.updateBatch(b.id, { status: BATCH_STATUS.OVERDUE });
      overdueCount++;
    } else if (b.status === BATCH_STATUS.OVERDUE) {
      overdueCount++;
    } else if (b.status === BATCH_STATUS.IN_PROGRESS || b.status === BATCH_STATUS.PAUSED) {
      const pending = (b.recipients || []).filter((r) => r.status === 'pending').length;
      activePendingCount += pending;
    }
  }

  // Check snoozed chats
  for (const s of snoozes) {
    if (s.status === SNOOZE_STATUS.AWAITING) {
      const dueTime = new Date(s.dueAt).getTime();
      if (dueTime <= now) {
        await StorageService.updateSnooze(s.id, { status: SNOOZE_STATUS.DUE });
        dueSnoozeCount++;
      }
    } else if (s.status === SNOOZE_STATUS.DUE) {
      dueSnoozeCount++;
    }
  }

  // Check due cadence enrollments (Feature 5)
  let dueCadenceCount = 0;
  try {
    const { due } = await StorageService.refreshDueCadenceEnrollments();
    dueCadenceCount = (due || []).length;
  } catch (e) {}

  const totalActionNeeded = overdueCount + dueSnoozeCount + dueCadenceCount;

  // Update Toolbar Badge
  if (totalActionNeeded > 0) {
    chrome.action.setBadgeText({ text: String(totalActionNeeded) });
    chrome.action.setBadgeBackgroundColor({ color: '#E53E3E' }); // Red for overdue / due
    chrome.action.setTitle({ title: `PingLater: ${totalActionNeeded} overdue follow-up(s), awaiting reply tasks, or due cadences!` });
  } else if (activePendingCount > 0) {
    chrome.action.setBadgeText({ text: String(activePendingCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#25D366' }); // Green for active messages
    chrome.action.setTitle({ title: `PingLater: ${activePendingCount} pending follow-up(s)` });
  } else {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'PingLater: Never forget a follow-up' });
  }

  return { overdueCount, activePendingCount, dueSnoozeCount };
}

// ==========================================
// MESSAGE ROUTER
// ==========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case 'SCHEDULE_BATCH': {
      const { batchId, scheduledAt } = message;
      const targetTime = new Date(scheduledAt).getTime();

      if (!isNaN(targetTime)) {
        const delayMs = targetTime - Date.now();
        if (delayMs <= 0) {
          // Trigger immediately
          triggerBatchDue(batchId);
        } else {
          // Schedule Chrome alarm
          chrome.alarms.create(batchId, { when: targetTime });
          console.log(`[PingLater] Scheduled alarm for ${batchId} at ${new Date(targetTime).toLocaleTimeString()}`);
        }
      }

      checkOverdueAndRefreshBadge();
      sendResponse({ success: true });
      break;
    }

    case 'CANCEL_BATCH_ALARM': {
      const { batchId } = message;
      chrome.alarms.clear(batchId);
      checkOverdueAndRefreshBadge();
      sendResponse({ success: true });
      break;
    }

    case 'BATCH_COMPLETED': {
      if (message.batchId) {
        chrome.alarms.clear(message.batchId);
      }
      checkOverdueAndRefreshBadge();
      sendResponse({ success: true });
      break;
    }

    case 'REFRESH_BADGE': {
      checkOverdueAndRefreshBadge().then((res) => sendResponse(res));
      return true; // async sendResponse
    }

    case 'OPEN_WORKSPACE': {
      openSendingWorkspace(message.batchId).then(() => sendResponse({ success: true }));
      return true;
    }

    case 'CLOSE_WHATSAPP_TABS': {
      chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, (tabs) => {
        if (tabs && tabs.length > 0) {
          const ids = tabs.map((t) => t.id).filter(Boolean);
          chrome.tabs.remove(ids).catch(() => {});
        }
      });
      sendResponse({ success: true });
      break;
    }

    case 'OPEN_DASHBOARD': {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
      sendResponse({ success: true });
      break;
    }

    case 'SCHEDULE_SNOOZE_ALARM': {
      const { snoozeId, dueAt } = message;
      const targetTime = new Date(dueAt).getTime();
      if (!isNaN(targetTime)) {
        chrome.alarms.create(snoozeId, { when: targetTime });
        console.log(`[PingLater] Scheduled snooze alarm for ${snoozeId} at ${new Date(targetTime).toLocaleTimeString()}`);
      }
      checkOverdueAndRefreshBadge();
      sendResponse({ success: true });
      break;
    }

    case 'CANCEL_SNOOZE_ALARM': {
      if (message.snoozeId) {
        chrome.alarms.clear(message.snoozeId);
      }
      checkOverdueAndRefreshBadge();
      sendResponse({ success: true });
      break;
    }

    case 'SAVE_TEMPLATE': {
      if (message.template) {
        StorageService.saveTemplate(message.template)
          .then((saved) => {
            sendResponse({ success: true, template: saved });
          })
          .catch((err) => {
            console.warn('[PingLater] Error saving template in background:', err);
            sendResponse({ success: false, error: err.message });
          });
        return true; // async sendResponse
      }
      break;
    }

    case 'OPEN_WHATSAPP_CHAT': {
      const { phone } = message;
      if (phone) {
        const cleanPhone = String(phone).replace(/\D/g, '');
        const url = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
        chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, (waTabs) => {
          if (waTabs.length > 0) {
            chrome.tabs.update(waTabs[0].id, { url, active: true });
          } else {
            chrome.tabs.create({ url, active: true });
          }
          sendResponse({ success: true });
        });
        return true;
      }
      break;
    }

    case 'CADENCE_CONTACT_REPLIED': {
      const { phone, name } = message;
      StorageService.recordCadenceContactReply(phone, name)
        .then((res) => {
          if (res.modifiedCount > 0) {
            console.log(`[PingLater] Auto-halted ${res.modifiedCount} cadence enrollment(s) for replied contact:`, name || phone);
            checkOverdueAndRefreshBadge();
          }
          sendResponse({ success: true, modifiedCount: res.modifiedCount });
        })
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    case 'SCHEDULE_CADENCE_ALARM': {
      const { enrollmentId, dueAt } = message;
      const targetTime = new Date(dueAt).getTime();
      if (!isNaN(targetTime)) {
        chrome.alarms.create(`cadence_${enrollmentId}`, { when: targetTime });
      }
      checkOverdueAndRefreshBadge();
      sendResponse({ success: true });
      break;
    }

    case 'CANCEL_CADENCE_ALARM': {
      if (message.enrollmentId) {
        chrome.alarms.clear(`cadence_${message.enrollmentId}`);
      }
      checkOverdueAndRefreshBadge();
      sendResponse({ success: true });
      break;
    }

    default:
      break;
  }
});
