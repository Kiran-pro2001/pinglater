/**
 * PingLater - Audio Notification Player
 * Plays the chime notification sound using local audio asset with Web Audio API fallback.
 */

export class SoundPlayer {
  static async playChime(volume = 0.8) {
    try {
      const audioUrl = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
        ? chrome.runtime.getURL('assets/sounds/chime.wav')
        : 'assets/sounds/chime.wav';

      const audio = new Audio(audioUrl);
      audio.volume = Math.max(0, Math.min(1, volume));
      await audio.play();
      return true;
    } catch (e) {
      console.warn('[PingLater Sound] Audio element playback failed, falling back to Web Audio API:', e);
      return this.synthesizeChime(volume);
    }
  }

  /**
   * Synthesizes a clean two-tone chime (A5 -> E6) using native Web Audio API
   */
  static synthesizeChime(volume = 0.8) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      const ctx = new AudioCtx();

      const now = ctx.currentTime;
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(volume * 0.5, now);
      masterGain.connect(ctx.destination);

      // Note 1: 880Hz (A5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.5, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc1.connect(gain1);
      gain1.connect(masterGain);
      osc1.start(now);
      osc1.stop(now + 0.25);

      // Note 2: 1320Hz (E6)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1320, now + 0.12);
      gain2.gain.setValueAtTime(0.7, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc2.connect(gain2);
      gain2.connect(masterGain);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.8);

      return true;
    } catch (err) {
      console.error('[PingLater Sound] Web Audio synthesis failed:', err);
      return false;
    }
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.PingLaterSound = SoundPlayer;
}
