# 🔔 PingLater — Day 002 of 365 Days, 365 Products

**Tagline:** *Never forget a follow-up.*  
Part of the **#365Days365Products** challenge by **Kiran Kumar** (Ex-Software Engineer at Oracle, Bengaluru, Bharat 🇮🇳).

---

## 📌 What is PingLater?

PingLater is a lightweight, privacy-first **WhatsApp follow-up workspace** built as a Chrome Extension (Manifest V3). 

Instead of an automated bulk spammer or unofficial bot that gets accounts banned, PingLater gives organizers, recruiters, founders, and community managers an organized, semi-automated assembly line:
1. **Import & Prepare**: Ingest CSV recipient lists, auto-normalize messy phone numbers, and craft dynamic templates (`{{name}}`, `{{ticket}}`, `{{event}}`).
2. **Schedule**: Set one-time future reminders with Chrome alarms or send immediately.
3. **Send with Safe Pacing**: When due, PingLater opens right beside WhatsApp Web using Chrome's **Side Panel API**. It auto-navigates your existing WhatsApp tab, pre-fills the message, lets you review and hit Send, and steps to the next recipient with an anti-ban countdown and audio chime.

---

## 🚀 Key Features

* **Chrome Side Panel Workspace (`sidepanel.html`)**: Pinned beside WhatsApp Web so you never lose context or close popup windows mid-batch.
* **Smart Tab Orchestrator**: Reuses a single existing WhatsApp Web tab rather than opening 50 new browser tabs.
* **Direct Prefill Routing**: Skips intermediate "Continue to Chat" landing pages and routes directly into the chat input box.
* **Dynamic CSV Variable Engine**: Maps **any** CSV column header (e.g. `{{ticket_number}}`, `{{company}}`, `{{role}}`) into personalized message templates with pre-flight health checks for missing fields.
* **Phone Sanitizer & Normalization**: Strips spaces, dashes, brackets, and domestic trunk zeros; auto-prepends your default country code (`+91`, `+1`, etc.).
* **Safe Pacing Delay**: Optional 4-second breather countdown between contacts with a pulsating timer and audio chime (`chime.wav`) to prevent WhatsApp account rate limits.
* **Power-User Shortcut**: Press **`Spacebar`** in the Side Panel to instantly mark sent and proceed to the next recipient.
* **Overdue Task Recovery**: Background service worker detects missed schedules if your laptop was asleep and flags them with an amber alert banner and badge count.
* **One-Click CSV Report**: Download delivery reports (`Status`, `SentAt`, `SkippedAt`) for complete audit trails.
* **100% Local & Private**: Stored entirely in `chrome.storage.local`. Zero external servers, zero database costs, zero WhatsApp credential scraping.

---

## 📁 Project Structure

```
PingLater/
├── manifest.json              # Chrome Manifest V3 configuration
├── background.js              # Service Worker: alarms, notifications, badge manager
├── sidepanel.html             # Side-by-side workspace beside WhatsApp Web
├── sidepanel.css              # Dark-mode styling, progress bar & pacing ring
├── sidepanel.js               # Active queue controller, Spacebar listener, auto-loader
├── dashboard.html             # Full-tab SaaS hub: Batches, CSV Wizard, Templates, Settings
├── dashboard.css              # Responsive layout with live phone preview mockup
├── dashboard.js               # Central dashboard controller & tab routing
├── popup.html                 # Lightweight toolbar quick menu
├── popup.css
├── popup.js
├── utils/
│   ├── storage.js             # Data persistence layer & schema manager (Module 1)
│   ├── normalizer.js          # CSV parser, phone sanitizer & column detector (Module 2)
│   ├── template.js            # Variable interpolation & URL encoder (Module 3)
│   ├── audio.js               # Local audio player with Web Audio API fallback (Module 4)
│   └── whatsapp.js            # WhatsApp tab reuse & navigation orchestrator (Module 5)
└── assets/
    ├── icons/                 # 16px, 32px, 48px, 128px extension icons
    └── sounds/
        └── chime.wav          # 16-bit PCM two-tone notification chime
```

---

## 🛠️ How to Load and Test the Extension in Chrome

1. Open Google Chrome.
2. Navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the `PingLater` directory:
   ```
   /home/kiran-kumar/HDD/shipping/365Days_365Products/day2/PingLater
   ```
6. The **PingLater** extension icon will appear in your Chrome toolbar.
7. Click the extension icon → click **Open Full Dashboard** to create your first batch!

---

## 📹 Daily Publishing Plan

- **Video 1**: *Day 2 of 365: The problem I'm solving — Never forgetting a WhatsApp follow-up*
- **Video 2**: *Day 2 of 365: Architecture & live demo of the Chrome Side Panel + WhatsApp Web integration*
- **Video 3**: *Day 2 of 365: Launching PingLater (Free & open-source on GitHub)*
