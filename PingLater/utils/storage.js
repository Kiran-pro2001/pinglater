/**
 * PingLater - Storage Engine (Module 1)
 * Universal storage layer for Chrome extension (Manifest V3)
 * Supports chrome.storage.local with browser localStorage fallback for development/testing.
 */

import { PRESET_CADENCES, CADENCE_STATUS, recordContactReplied, checkDueEnrollments, normalizeCadencePhone } from './cadence.js';

// Storage keys
export const STORAGE_KEYS = {
  BATCHES: 'pinglater_batches',
  TEMPLATES: 'pinglater_templates',
  CONTACTS: 'pinglater_contacts',
  SETTINGS: 'pinglater_settings',
  LOGS: 'pinglater_logs',
  SNOOZED_CHATS: 'pinglater_snoozed_chats',
  CADENCE_BLUEPRINTS: 'pinglater_cadence_blueprints',
  CADENCE_ENROLLMENTS: 'pinglater_cadence_enrollments'
};

// Snooze Status for "Awaiting Reply" Tracker (Feature 2)
export const SNOOZE_STATUS = {
  AWAITING: 'awaiting',
  REPLIED: 'replied',
  DUE: 'due',
  DISMISSED: 'dismissed'
};

// Batch & Recipient Status Constants
export const BATCH_STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  OVERDUE: 'overdue',
  IN_PROGRESS: 'in_progress',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

export const RECIPIENT_STATUS = {
  PENDING: 'pending',
  OPENED: 'opened',
  SENT: 'sent',
  SKIPPED: 'skipped'
};

// Default Settings
export const DEFAULT_SETTINGS = {
  defaultCountryCode: '91',       // Default country code (e.g. 91 for India)
  defaultPacingSeconds: 10,       // Safe 10-second anti-ban delay between sends
  soundEnabled: true,             // Audio ping when ready
  soundVolume: 0.8,               // 0 to 1
  autoLoadNext: true,             // Auto-load next contact after pacing delay
  showOverdueBanner: true         // Warn user when scheduled tasks were missed
};

// Starter Templates seeded on first launch (Professional & Casual/Informal)
export const SEED_TEMPLATES = [
  // High-Utility Quick Snippets (In-Chat /shortcuts)
  {
    id: 'tpl_quick_meet',
    title: 'Google Meet / Calendar Booking',
    category: 'Professional',
    shortcut: 'cal',
    body: 'Hi {{name}}, here is my calendar link to grab a quick 15-min call: https://meet.google.com/ or https://calendly.com/\n\nPick whatever time slot works best for you!',
    variables: ['name'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'tpl_quick_pricing',
    title: 'Standard Pricing Packages',
    category: 'Professional',
    shortcut: 'pricing',
    body: 'Hi {{name}}, here are our standard packages:\n1️⃣ Starter: $499 (Core delivery & setup)\n2️⃣ Growth: $1,299 (Full feature rollout & support)\n3️⃣ Custom Enterprise: Tailored to your roadmap\n\nLet me know which tier fits your current stage!',
    variables: ['name'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'tpl_quick_payment',
    title: 'Payment & Bank Account Details',
    category: 'Professional',
    shortcut: 'pay',
    body: 'Here are the payment details for your invoice:\n• UPI ID: yourname@upi\n• Account: 50100XXXXXXX\n• IFSC/Routing: HDFC0001234\n\nPlease reply with a screenshot once transferred so we can generate your receipt!',
    variables: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  // Professional Follow-ups
  {
    id: 'tpl_client_followup_prof',
    title: 'Client Proposal Follow-up (Professional)',
    category: 'Professional',
    shortcut: 'proposal',
    body: 'Hi {{name}}, hope you\'re having a productive week. Following up on our discussion regarding {{topic}}. Did you get a chance to review the details? Let me know if you have any questions!',
    variables: ['name', 'topic'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'tpl_project_checkin_prof',
    title: 'Project Status Update (Professional)',
    category: 'Professional',
    shortcut: 'update',
    body: 'Hi {{name}}, just checking in on the deliverables for {{project}}. Let me know if you need any input or review from my side.',
    variables: ['name', 'project'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'tpl_event_confirmation',
    title: 'Event Pass Confirmation (Professional)',
    category: 'Professional',
    shortcut: 'pass',
    body: 'Hi {{name}}, your registration for {{event}} is confirmed! 🎟️\n\nAccess link: {{link}}\n\nLooking forward to seeing you there!',
    variables: ['name', 'event', 'link'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  // Casual / Informal Templates
  {
    id: 'tpl_casual_catchup',
    title: 'Hey What\'s Up! (Casual / Friendly)',
    category: 'Casual',
    shortcut: 'catchup',
    body: 'Hey {{name}}, what\'s up! Long time, was just thinking about you. Hope all is well! Let\'s catch up soon ☕',
    variables: ['name'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'tpl_quick_nudge_casual',
    title: 'Quick Friendly Nudge (Casual)',
    category: 'Casual',
    shortcut: 'nudge',
    body: 'Hey {{name}}! 👋 Just wanted to say hi and see how things are going on your end. Ping me when you get a free minute!',
    variables: ['name'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'tpl_miss_you_personal',
    title: 'Thinking of You / Check-in (Personal)',
    category: 'Casual',
    shortcut: 'checkin',
    body: 'Hi {{name}}, hope you\'re having a great week! Just wanted to check in and see how you\'ve been doing. Let\'s talk soon ❤️',
    variables: ['name'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

// In-memory fallback map for non-browser/Node.js testing environments
const memoryStore = new Map();

/**
 * Low-level storage adapter: uses chrome.storage.local if available, else localStorage, else in-memory
 */
class StorageAdapter {
  static isChromeStorageAvailable() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  static isLocalStorageAvailable() {
    return typeof localStorage !== 'undefined';
  }

  static async get(key) {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
          resolve(result[key]);
        });
      });
    }
    if (this.isLocalStorageAvailable()) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : undefined;
      } catch (e) {
        console.warn('[PingLater Storage] LocalStorage read failed:', e);
        return undefined;
      }
    }
    return memoryStore.get(key);
  }

  static async set(key, value) {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve(true));
      });
    }
    if (this.isLocalStorageAvailable()) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.error('[PingLater Storage] LocalStorage write failed:', e);
        return false;
      }
    }
    memoryStore.set(key, JSON.parse(JSON.stringify(value)));
    return true;
  }

  static async remove(key) {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.remove([key], () => resolve(true));
      });
    }
    if (this.isLocalStorageAvailable()) {
      localStorage.removeItem(key);
      return true;
    }
    memoryStore.delete(key);
    return true;
  }

  static async clear() {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.clear(() => resolve(true));
      });
    }
    if (this.isLocalStorageAvailable()) {
      localStorage.clear();
      return true;
    }
    memoryStore.clear();
    return true;
  }
}

/**
 * High-level Storage Manager
 */
export class StorageService {
  /**
   * Initializes default settings & starter templates if empty.
   */
  static async initDefaults() {
    const existingSettings = await this.getSettings();
    if (!existingSettings || Object.keys(existingSettings).length === 0) {
      await this.saveSettings(DEFAULT_SETTINGS);
    }

    const existingTemplates = await this.getTemplates();
    if (!existingTemplates || existingTemplates.length === 0) {
      await StorageAdapter.set(STORAGE_KEYS.TEMPLATES, SEED_TEMPLATES);
    } else {
      // Merge any new seed templates that don't exist yet
      const existingIds = new Set(existingTemplates.map((t) => t.id));
      const missing = SEED_TEMPLATES.filter((t) => !existingIds.has(t.id));
      let merged = [...existingTemplates];

      if (missing.length > 0) {
        merged = [...merged, ...missing];
      }

      // Backfill shortcuts on existing templates if missing
      merged.forEach((tpl) => {
        if (!tpl.shortcut) {
          const match = SEED_TEMPLATES.find((st) => st.id === tpl.id);
          if (match && match.shortcut) {
            tpl.shortcut = match.shortcut;
          }
        }
      });

      await StorageAdapter.set(STORAGE_KEYS.TEMPLATES, merged);
    }

    const existingBatches = await this.getBatches();
    if (!existingBatches) {
      await StorageAdapter.set(STORAGE_KEYS.BATCHES, []);
    }

    const existingContacts = await this.getContacts();
    if (!existingContacts) {
      await StorageAdapter.set(STORAGE_KEYS.CONTACTS, []);
    }

    const existingSnoozes = await this.getSnoozes();
    if (!existingSnoozes) {
      await StorageAdapter.set(STORAGE_KEYS.SNOOZED_CHATS, []);
    }
  }

  // ==========================================
  // SETTINGS
  // ==========================================
  static async getSettings() {
    const settings = await StorageAdapter.get(STORAGE_KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  }

  static async saveSettings(newSettings) {
    const current = await this.getSettings();
    const updated = { ...current, ...newSettings };
    await StorageAdapter.set(STORAGE_KEYS.SETTINGS, updated);
    return updated;
  }

  // ==========================================
  // TEMPLATES
  // ==========================================
  static async getTemplates() {
    const list = await StorageAdapter.get(STORAGE_KEYS.TEMPLATES);
    return Array.isArray(list) ? list : [];
  }

  static async getTemplateById(id) {
    const list = await this.getTemplates();
    return list.find((t) => t.id === id) || null;
  }

  static async saveTemplate(template) {
    const list = await this.getTemplates();
    const now = new Date().toISOString();
    let saved;

    if (template.id) {
      const idx = list.findIndex((t) => t.id === template.id);
      if (idx >= 0) {
        saved = { ...list[idx], ...template, updatedAt: now };
        list[idx] = saved;
      } else {
        saved = { ...template, createdAt: template.createdAt || now, updatedAt: now };
        list.push(saved);
      }
    } else {
      saved = {
        ...template,
        id: `tpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        createdAt: now,
        updatedAt: now
      };
      list.push(saved);
    }

    await StorageAdapter.set(STORAGE_KEYS.TEMPLATES, list);
    return saved;
  }

  static async deleteTemplate(id) {
    const list = await this.getTemplates();
    const filtered = list.filter((t) => t.id !== id);
    await StorageAdapter.set(STORAGE_KEYS.TEMPLATES, filtered);
    return true;
  }

  // ==========================================
  // BATCHES & FOLLOW-UPS
  // ==========================================
  static async getBatches() {
    const list = await StorageAdapter.get(STORAGE_KEYS.BATCHES);
    return Array.isArray(list) ? list : [];
  }

  static async getBatchById(id) {
    const list = await this.getBatches();
    return list.find((b) => b.id === id) || null;
  }

  static async saveBatch(batch) {
    const list = await this.getBatches();
    const now = new Date().toISOString();
    let saved;

    if (batch.id) {
      const idx = list.findIndex((b) => b.id === batch.id);
      if (idx >= 0) {
        saved = { ...list[idx], ...batch, updatedAt: now };
        list[idx] = saved;
      } else {
        saved = { ...batch, createdAt: batch.createdAt || now, updatedAt: now };
        list.push(saved);
      }
    } else {
      saved = {
        ...batch,
        id: `batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        status: batch.status || BATCH_STATUS.SCHEDULED,
        currentIndex: batch.currentIndex || 0,
        createdAt: now,
        updatedAt: now
      };
      list.unshift(saved); // prepend newest
    }

    await StorageAdapter.set(STORAGE_KEYS.BATCHES, list);
    return saved;
  }

  static async updateBatch(id, updates) {
    const list = await this.getBatches();
    const idx = list.findIndex((b) => b.id === id);
    if (idx === -1) return null;

    const now = new Date().toISOString();
    list[idx] = { ...list[idx], ...updates, updatedAt: now };
    await StorageAdapter.set(STORAGE_KEYS.BATCHES, list);
    return list[idx];
  }

  static async deleteBatch(id) {
    const list = await this.getBatches();
    const filtered = list.filter((b) => b.id !== id);
    await StorageAdapter.set(STORAGE_KEYS.BATCHES, filtered);
    return true;
  }

  /**
   * Updates an individual recipient's status inside a batch
   * (e.g. marking as sent, skipped, or advancing index).
   */
  static async updateBatchRecipient(batchId, recipientIndex, updates) {
    const batch = await this.getBatchById(batchId);
    if (!batch || !batch.recipients || !batch.recipients[recipientIndex]) {
      return null;
    }

    const now = new Date().toISOString();
    const recipient = batch.recipients[recipientIndex];
    batch.recipients[recipientIndex] = {
      ...recipient,
      ...updates,
      ...(updates.status === RECIPIENT_STATUS.SENT && !recipient.sentAt ? { sentAt: now } : {}),
      ...(updates.status === RECIPIENT_STATUS.SKIPPED && !recipient.skippedAt ? { skippedAt: now } : {})
    };

    // Calculate completed stats
    const total = batch.recipients.length;
    const sentCount = batch.recipients.filter((r) => r.status === RECIPIENT_STATUS.SENT).length;
    const skippedCount = batch.recipients.filter((r) => r.status === RECIPIENT_STATUS.SKIPPED).length;
    const isCompleted = sentCount + skippedCount >= total;

    if (isCompleted) {
      batch.status = BATCH_STATUS.COMPLETED;
      batch.completedAt = now;
    } else if (batch.status === BATCH_STATUS.SCHEDULED || batch.status === BATCH_STATUS.OVERDUE) {
      batch.status = BATCH_STATUS.IN_PROGRESS;
    }

    batch.updatedAt = now;
    return await this.updateBatch(batchId, batch);
  }

  /**
   * Returns active, due, or overdue batches that require attention
   */
  static async getDueOrOverdueBatches() {
    const list = await this.getBatches();
    const now = Date.now();
    return list.filter((b) => {
      if (b.status === BATCH_STATUS.COMPLETED || b.status === BATCH_STATUS.CANCELLED) return false;
      const scheduledTime = new Date(b.scheduledAt).getTime();
      return scheduledTime <= now;
    });
  }

  // ==========================================
  // SAVED CONTACTS BOOK
  // ==========================================
  static async getContacts() {
    const list = await StorageAdapter.get(STORAGE_KEYS.CONTACTS);
    return Array.isArray(list) ? list : [];
  }

  static async saveContacts(newContacts) {
    const list = await this.getContacts();
    const existingMap = new Map(list.map((c) => [c.phone, c]));

    for (const c of newContacts) {
      if (!c.phone) continue;
      const existing = existingMap.get(c.phone);
      if (existing) {
        existingMap.set(c.phone, { ...existing, ...c, updatedAt: new Date().toISOString() });
      } else {
        existingMap.set(c.phone, {
          ...c,
          id: c.id || `cnt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          createdAt: new Date().toISOString()
        });
      }
    }

    const updated = Array.from(existingMap.values());
    await StorageAdapter.set(STORAGE_KEYS.CONTACTS, updated);
    return updated;
  }

  static async deleteContact(id) {
    const list = await this.getContacts();
    const filtered = list.filter((c) => c.id !== id);
    await StorageAdapter.set(STORAGE_KEYS.CONTACTS, filtered);
    return true;
  }

  // ==========================================
  // "AWAITING REPLY" SMART SNOOZE (FEATURE 2)
  // ==========================================
  static async getSnoozes() {
    const list = await StorageAdapter.get(STORAGE_KEYS.SNOOZED_CHATS);
    return Array.isArray(list) ? list : [];
  }

  static async getSnoozeById(id) {
    const list = await this.getSnoozes();
    return list.find((s) => s.id === id) || null;
  }

  static async saveSnooze(snooze) {
    const list = await this.getSnoozes();
    const now = new Date().toISOString();
    let saved;

    if (snooze.id) {
      const idx = list.findIndex((s) => s.id === snooze.id);
      if (idx >= 0) {
        saved = { ...list[idx], ...snooze, updatedAt: now };
        list[idx] = saved;
      } else {
        saved = { ...snooze, createdAt: snooze.createdAt || now, updatedAt: now };
        list.push(saved);
      }
    } else {
      saved = {
        ...snooze,
        id: `snooze_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        status: snooze.status || SNOOZE_STATUS.AWAITING,
        createdAt: now,
        updatedAt: now
      };
      list.unshift(saved);
    }

    await StorageAdapter.set(STORAGE_KEYS.SNOOZED_CHATS, list);

    // Notify background to schedule/update alarm if awaiting
    if (saved.status === SNOOZE_STATUS.AWAITING && saved.dueAt) {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'SCHEDULE_SNOOZE_ALARM',
          snoozeId: saved.id,
          dueAt: saved.dueAt,
          contactName: saved.contactName,
          phone: saved.phone
        }).catch(() => {});
      }
    }

    return saved;
  }

  static async updateSnooze(id, updates) {
    const list = await this.getSnoozes();
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return null;

    const now = new Date().toISOString();
    list[idx] = { ...list[idx], ...updates, updatedAt: now };
    await StorageAdapter.set(STORAGE_KEYS.SNOOZED_CHATS, list);

    // If status became resolved, replied, or dismissed, cancel alarm
    if ([SNOOZE_STATUS.REPLIED, SNOOZE_STATUS.DISMISSED].includes(list[idx].status)) {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'CANCEL_SNOOZE_ALARM',
          snoozeId: id
        }).catch(() => {});
      }
    }

    return list[idx];
  }

  static async deleteSnooze(id) {
    const list = await this.getSnoozes();
    const filtered = list.filter((s) => s.id !== id);
    await StorageAdapter.set(STORAGE_KEYS.SNOOZED_CHATS, filtered);
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'CANCEL_SNOOZE_ALARM',
        snoozeId: id
      }).catch(() => {});
    }
    return true;
  }

  /**
   * Finds any active "awaiting" snooze for a given contact
   * Matches by cleaned phone or case-insensitive contact name.
   */
  static async findActiveSnooze(identifier) {
    if (!identifier) return null;
    const cleanTarget = String(identifier).replace(/\D/g, '');
    const textTarget = String(identifier).trim().toLowerCase();
    const list = await this.getSnoozes();

    return list.find((s) => {
      if (s.status !== SNOOZE_STATUS.AWAITING) return false;
      if (cleanTarget && s.phone && String(s.phone).replace(/\D/g, '') === cleanTarget) {
        return true;
      }
      if (textTarget && s.contactName && s.contactName.trim().toLowerCase() === textTarget) {
        return true;
      }
      return false;
    }) || null;
  }

  /**
   * Auto-resolves a snooze when incoming reply is detected
   */
  static async markSnoozeReplied(identifier, replySnippet = '') {
    const active = await this.findActiveSnooze(identifier);
    if (!active) return null;

    const updated = await this.updateSnooze(active.id, {
      status: SNOOZE_STATUS.REPLIED,
      repliedAt: new Date().toISOString(),
      replySnippet: replySnippet || 'Incoming reply received'
    });

    return updated;
  }

  static async getAwaitingStats() {
    const list = await this.getSnoozes();
    const now = Date.now();
    let awaiting = 0;
    let due = 0;
    let replied = 0;

    list.forEach((s) => {
      if (s.status === SNOOZE_STATUS.REPLIED) {
        replied++;
      } else if (s.status === SNOOZE_STATUS.AWAITING) {
        if (new Date(s.dueAt).getTime() <= now) {
          due++;
        } else {
          awaiting++;
        }
      } else if (s.status === SNOOZE_STATUS.DUE) {
        due++;
      }
    });

    return { awaiting, due, replied, total: list.length };
  }

  // ==========================================
  // MULTI-STEP CADENCES (Feature 5)
  // ==========================================
  static async getCadenceBlueprints() {
    const list = await StorageAdapter.get(STORAGE_KEYS.CADENCE_BLUEPRINTS);
    if (!list || list.length === 0) {
      await StorageAdapter.set(STORAGE_KEYS.CADENCE_BLUEPRINTS, PRESET_CADENCES);
      return PRESET_CADENCES;
    }
    return list;
  }

  static async saveCadenceBlueprint(blueprint) {
    const list = await this.getCadenceBlueprints();
    const index = list.findIndex((c) => c.id === blueprint.id);
    if (index >= 0) {
      list[index] = { ...blueprint, updatedAt: new Date().toISOString() };
    } else {
      list.unshift(blueprint);
    }
    await StorageAdapter.set(STORAGE_KEYS.CADENCE_BLUEPRINTS, list);
    return blueprint;
  }

  static async deleteCadenceBlueprint(id) {
    const list = await this.getCadenceBlueprints();
    const updated = list.filter((c) => c.id !== id);
    await StorageAdapter.set(STORAGE_KEYS.CADENCE_BLUEPRINTS, updated);
    return true;
  }

  static async getCadenceEnrollments() {
    const list = await StorageAdapter.get(STORAGE_KEYS.CADENCE_ENROLLMENTS);
    return list || [];
  }

  static async saveCadenceEnrollment(enrollment) {
    const list = await this.getCadenceEnrollments();
    const index = list.findIndex((e) => e.id === enrollment.id);
    if (index >= 0) {
      list[index] = { ...enrollment, updatedAt: new Date().toISOString() };
    } else {
      list.unshift(enrollment);
    }
    await StorageAdapter.set(STORAGE_KEYS.CADENCE_ENROLLMENTS, list);
    return enrollment;
  }

  static async saveCadenceEnrollmentsBatch(newEnrollments = []) {
    if (!newEnrollments.length) return [];
    const list = await this.getCadenceEnrollments();
    const map = new Map(list.map((e) => [e.id, e]));
    for (const enr of newEnrollments) {
      map.set(enr.id, enr);
    }
    const combined = Array.from(map.values());
    await StorageAdapter.set(STORAGE_KEYS.CADENCE_ENROLLMENTS, combined);
    return combined;
  }

  static async deleteCadenceEnrollment(id) {
    const list = await this.getCadenceEnrollments();
    const updated = list.filter((e) => e.id !== id);
    await StorageAdapter.set(STORAGE_KEYS.CADENCE_ENROLLMENTS, updated);
    return true;
  }

  /**
   * Stop-on-Reply handler:
   * When an incoming reply is detected for a contact, automatically transitions
   * all active/due/awaiting cadence enrollments for that contact to 'replied'.
   */
  static async recordCadenceContactReply(phone, contactName, replyTimestamp = new Date()) {
    const list = await this.getCadenceEnrollments();
    if (!list || list.length === 0) return { modifiedCount: 0, haltedEnrollments: [] };

    const cleanPhone = normalizeCadencePhone(phone);
    const lowerName = (contactName || '').trim().toLowerCase();
    const haltedEnrollments = [];

    const updatedList = list.map((enr) => {
      // Terminal states already halted
      if ([CADENCE_STATUS.REPLIED, CADENCE_STATUS.COMPLETED, CADENCE_STATUS.CANCELLED].includes(enr.status)) {
        return enr;
      }

      const enrCleanPhone = normalizeCadencePhone(enr.cleanPhone || enr.phone);
      const enrLowerName = (enr.contactName || '').trim().toLowerCase();

      let isMatch = false;
      if (cleanPhone && enrCleanPhone && (cleanPhone === enrCleanPhone || cleanPhone.endsWith(enrCleanPhone) || enrCleanPhone.endsWith(cleanPhone))) {
        isMatch = true;
      } else if (lowerName && enrLowerName && (lowerName === enrLowerName || lowerName.includes(enrLowerName) || enrLowerName.includes(lowerName))) {
        isMatch = true;
      }

      if (isMatch) {
        const halted = recordContactReplied(enr, replyTimestamp);
        haltedEnrollments.push(halted);
        return halted;
      }
      return enr;
    });

    if (haltedEnrollments.length > 0) {
      await StorageAdapter.set(STORAGE_KEYS.CADENCE_ENROLLMENTS, updatedList);
    }

    return { modifiedCount: haltedEnrollments.length, haltedEnrollments };
  }

  /**
   * Evaluates due cadence follow-ups and returns items ready for the Side Panel.
   */
  static async refreshDueCadenceEnrollments(referenceTime = new Date()) {
    const list = await this.getCadenceEnrollments();
    const { updatedList, dueItems } = checkDueEnrollments(list, referenceTime);
    if (dueItems.length > 0) {
      await StorageAdapter.set(STORAGE_KEYS.CADENCE_ENROLLMENTS, updatedList);
    }
    return { all: updatedList, due: dueItems };
  }

  // ==========================================
  // BACKUP & RESTORE
  // ==========================================
  static async exportAllData() {
    const settings = await this.getSettings();
    const templates = await this.getTemplates();
    const batches = await this.getBatches();
    const contacts = await this.getContacts();
    const snoozes = await this.getSnoozes();
    const cadenceBlueprints = await this.getCadenceBlueprints();
    const cadenceEnrollments = await this.getCadenceEnrollments();

    return {
      version: '1.1.0',
      exportedAt: new Date().toISOString(),
      settings,
      templates,
      batches,
      contacts,
      snoozes,
      cadenceBlueprints,
      cadenceEnrollments
    };
  }

  static async importAllData(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid backup payload');
    if (payload.settings) await StorageAdapter.set(STORAGE_KEYS.SETTINGS, payload.settings);
    if (payload.templates) await StorageAdapter.set(STORAGE_KEYS.TEMPLATES, payload.templates);
    if (payload.batches) await StorageAdapter.set(STORAGE_KEYS.BATCHES, payload.batches);
    if (payload.contacts) await StorageAdapter.set(STORAGE_KEYS.CONTACTS, payload.contacts);
    if (payload.snoozes) await StorageAdapter.set(STORAGE_KEYS.SNOOZED_CHATS, payload.snoozes);
    if (payload.cadenceBlueprints) await StorageAdapter.set(STORAGE_KEYS.CADENCE_BLUEPRINTS, payload.cadenceBlueprints);
    if (payload.cadenceEnrollments) await StorageAdapter.set(STORAGE_KEYS.CADENCE_ENROLLMENTS, payload.cadenceEnrollments);
    return true;
  }

  static async clearAllData() {
    await StorageAdapter.clear();
    await this.initDefaults();
    return true;
  }
}

// Attach to globalThis for non-module script access if needed
if (typeof globalThis !== 'undefined') {
  globalThis.PingLaterStorage = StorageService;
  globalThis.BATCH_STATUS = BATCH_STATUS;
  globalThis.RECIPIENT_STATUS = RECIPIENT_STATUS;
  globalThis.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  globalThis.SNOOZE_STATUS = SNOOZE_STATUS;
}
