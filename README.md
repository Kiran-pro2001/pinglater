# 🔔 PingLater — Day 002 of #365Days365Products

> **Never lose a client to a forgotten message.**  
> A lightweight, privacy-first WhatsApp follow-up workspace right in your browser side-panel.

Built by **Kiran Kumar** (Ex-Software Engineer at Oracle, Bengaluru, Bharat 🇮🇳) as part of the **#365Days365Products** challenge.

---

## 📁 Repository Structure

```
day2/
├── PingLater/         # 🧩 Chrome Extension (Manifest V3)
│   ├── manifest.json  # Extension manifest & permissions
│   ├── sidepanel.html # Side-by-side WhatsApp Web workspace
│   ├── dashboard.html # Batch wizard, templates & settings
│   ├── background.js  # Service worker, alarms & badge manager
│   └── utils/         # Tab orchestrator, CSV parser, storage engine
└── landing-page/      # 🌐 Product Landing Page & Marketing Site
```

---

## 🚀 What is PingLater?

PingLater solves the #1 reason founders and freelancers lose deals: **the follow-up they composed in their head but forgot to send.**

Instead of dangerous bulk auto-spammers that get WhatsApp accounts banned, PingLater gives you a semi-automated assembly line:
1. **Import & Prepare:** Upload CSV recipient lists, auto-normalize messy numbers, and craft dynamic message templates (`{{name}}`, `{{ticket}}`, `{{company}}`).
2. **Schedule:** Set one-time future reminders with Chrome alarms or send immediately.
3. **Send with Safe Pacing:** When due, PingLater opens right beside WhatsApp Web in Chrome's **Side Panel**. It navigates your existing WhatsApp tab, pre-fills the message, lets you review and hit Send, and steps to the next contact with safe anti-ban pacing and audio cues.

---

## 🛠️ How to Load and Test the Extension

1. Clone this repository:
   ```bash
   git clone https://github.com/Kiran-pro2001/pinglater.git
   ```
2. Open Google Chrome or Brave and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the **`PingLater`** folder inside this repository:
   ```
   path/to/pinglater/PingLater
   ```
6. The PingLater icon will appear in your Chrome toolbar. Click it or open `dashboard.html` to start!

---

## 📜 License
MIT License. Free and open source for the community.
