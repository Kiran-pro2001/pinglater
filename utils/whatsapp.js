/**
 * PingLater - WhatsApp Tab Orchestrator (Module 5)
 * Manages finding, focusing, and navigating WhatsApp Web tabs.
 * Automatically cleans up redundant duplicate WhatsApp tabs to avoid the
 * "Use WhatsApp Web here?" multiple-window warning.
 */

import { generateWhatsAppUrl } from './template.js';

export class WhatsAppOrchestrator {
  /**
   * Finds all active or background tabs running WhatsApp Web.
   * @returns {Promise<chrome.tabs.Tab[]>}
   */
  static async findAllWhatsAppTabs() {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
      return [];
    }

    try {
      const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
      return tabs || [];
    } catch (e) {
      console.warn('[PingLater WhatsApp] Error finding WhatsApp tabs:', e);
      return [];
    }
  }

  /**
   * Closes all duplicate/redundant WhatsApp Web tabs, keeping only one primary tab.
   */
  static async cleanupRedundantTabs() {
    try {
      const allTabs = await this.findAllWhatsAppTabs();
      if (allTabs.length > 1) {
        const redundantIds = allTabs.slice(1).map((t) => t.id).filter(Boolean);
        if (redundantIds.length > 0) {
          await chrome.tabs.remove(redundantIds).catch((err) => {
            console.warn('[PingLater WhatsApp] Could not close redundant tabs:', err);
          });
        }
      }
    } catch (e) {
      console.warn('[PingLater WhatsApp] Error cleaning up tabs:', e);
    }
  }

  /**
   * Directly loads a contact and prefilled message into WhatsApp Web.
   * If multiple WhatsApp tabs are open, closes all duplicates and reuses the single active tab!
   *
   * @param {string} phone - Sanitized phone number (e.g. "919876543210")
   * @param {string} renderedMessage - Message body
   * @returns {Promise<{ success: boolean, tabId?: number, url: string }>}
   */
  static async loadContact(phone, renderedMessage) {
    const waUrl = generateWhatsAppUrl(phone, renderedMessage);

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        // First, close all redundant WhatsApp Web tabs across all windows
        await this.cleanupRedundantTabs();

        const allTabs = await this.findAllWhatsAppTabs();

        if (allTabs.length > 0) {
          // Choose the first tab as the single primary tab
          const primaryTab = allTabs[0];

          // If any remaining redundant tabs exist, close them immediately
          if (allTabs.length > 1) {
            const redundantIds = allTabs.slice(1).map((t) => t.id).filter(Boolean);
            if (redundantIds.length > 0) {
              await chrome.tabs.remove(redundantIds).catch((err) => {
                console.warn('[PingLater WhatsApp] Could not close redundant tabs:', err);
              });
            }
          }

          // Navigate the single primary WhatsApp Web tab
          await chrome.tabs.update(primaryTab.id, { url: waUrl, active: true });
          if (primaryTab.windowId && chrome.windows && chrome.windows.update) {
            await chrome.windows.update(primaryTab.windowId, { focused: true }).catch(() => {});
          }

          return { success: true, tabId: primaryTab.id, url: waUrl };
        } else {
          // No open WhatsApp tab found at all: open a single fresh tab
          const newTab = await chrome.tabs.create({ url: waUrl, active: true });
          return { success: true, tabId: newTab ? newTab.id : undefined, url: waUrl };
        }
      }
    } catch (err) {
      console.warn('[PingLater WhatsApp] chrome.tabs navigation failed, using window.open fallback:', err);
    }

    // Direct window.open fallback
    if (typeof window !== 'undefined') {
      window.open(waUrl, '_blank');
    }
    return { success: true, url: waUrl };
  }

  /**
   * Clears any lingering text in the WhatsApp Web message box (contenteditable composer).
   */
  static async clearWhatsAppInput() {
    try {
      const tabs = await this.findAllWhatsAppTabs();
      if (!tabs || tabs.length === 0) return;

      if (typeof chrome !== 'undefined' && chrome.scripting && chrome.scripting.executeScript) {
        for (const tab of tabs) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                try {
                  const composer = document.querySelector('footer div[contenteditable="true"]') ||
                                   document.querySelector('div[data-tab="10"][contenteditable="true"]') ||
                                   document.querySelector('div[contenteditable="true"]');
                  if (composer) {
                    composer.focus();
                    composer.innerHTML = '';
                    composer.textContent = '';
                    composer.innerText = '';
                    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));
                    composer.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                } catch (e) {
                  // DOM error or cross-origin boundary
                }
              }
            });
          } catch (e) {
            console.warn('[PingLater WhatsApp] Could not execute clear script on tab:', tab.id, e);
          }
        }
      }
    } catch (e) {
      console.warn('[PingLater WhatsApp] Error clearing WhatsApp input:', e);
    }
  }

  /**
   * Wipes any active message text in WhatsApp Web and closes all WhatsApp Web tabs across all windows.
   */
  static async closeWhatsAppTabs() {
    try {
      // 1. Wipe text from composer first so it does not persist in session
      await this.clearWhatsAppInput().catch(() => {});

      // 2. Small 150ms buffer to allow input events to flush
      await new Promise((resolve) => setTimeout(resolve, 150));

      // 3. Close all WhatsApp Web tabs
      const tabs = await this.findAllWhatsAppTabs();
      if (tabs && tabs.length > 0) {
        const tabIds = tabs.map((t) => t.id).filter(Boolean);
        if (tabIds.length > 0) {
          await chrome.tabs.remove(tabIds).catch((err) => {
            console.warn('[PingLater WhatsApp] Could not close tabs:', err);
          });
        }
      }
    } catch (e) {
      console.warn('[PingLater WhatsApp] Error in closeWhatsAppTabs:', e);
    }
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.PingLaterWhatsApp = WhatsAppOrchestrator;
}
