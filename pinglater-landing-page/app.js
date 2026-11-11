/**
 * PingLater Landing Page Interactivity Engine
 * Features:
 * - Low-CPU Ambient Particle Canvas with visibility pausing
 * - Desktop 3D Parallax Tilt with lerp smoothing (data-tilt)
 * - Interactive Live WhatsApp HUD Simulator with live countdown & auto-reply toggle
 * - Dynamic Currency Switcher (INR ₹1,499 vs USD $39)
 * - Accessible FAQ Accordion with smooth height transitions
 */

(function () {
  'use strict';

  // ==========================================
  // 1. CURRENCY TOGGLE (INR vs USD)
  // ==========================================
  window.setCurrency = function (curr) {
    const btnInr = document.getElementById('btn-curr-inr');
    const btnUsd = document.getElementById('btn-curr-usd');
    const viewInr = document.getElementById('price-inr');
    const viewUsd = document.getElementById('price-usd');
    const ctaBtn = document.getElementById('pricing-cta-btn');

    if (curr === 'USD') {
      btnInr.classList.remove('active');
      btnUsd.classList.add('active');
      viewInr.style.display = 'none';
      viewUsd.style.display = 'flex';

      if (ctaBtn) {
        ctaBtn.href = "https://wa.me/918590658979?text=Hey%20Kiran%2C%20I%20want%20to%20get%20Lifetime%20Access%20to%20PingLater%20(USD%20%2439%20Pass).%20How%20do%20I%20pay%20via%20Stripe%20or%20Card%3F";
      }
    } else {
      btnUsd.classList.remove('active');
      btnInr.classList.add('active');
      viewUsd.style.display = 'none';
      viewInr.style.display = 'flex';

      if (ctaBtn) {
        ctaBtn.href = "https://wa.me/918590658979?text=Hey%20Kiran%2C%20I%20want%20to%20get%20Lifetime%20Access%20to%20PingLater%20(INR%20%E2%82%B91%2C499%20Pass).%20How%20do%20I%20pay%20via%20UPI%20and%20get%20started%3F";
      }
    }
  };

  // ==========================================
  // 2. FAQ ACCORDION ENGINE
  // ==========================================
  function initFaq() {
    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach((item) => {
      const questionBtn = item.querySelector('.faq-question');
      const answer = item.querySelector('.faq-answer');

      questionBtn.addEventListener('click', () => {
        const isActive = item.classList.contains('active');

        // Close all other items
        faqItems.forEach((other) => {
          if (other !== item && other.classList.contains('active')) {
            other.classList.remove('active');
            const otherAns = other.querySelector('.faq-answer');
            if (otherAns) otherAns.style.maxHeight = null;
          }
        });

        // Toggle current item
        if (isActive) {
          item.classList.remove('active');
          answer.style.maxHeight = null;
        } else {
          item.classList.add('active');
          answer.style.maxHeight = answer.scrollHeight + 32 + 'px';
        }
      });
    });

    // Auto-open first FAQ by default
    if (faqItems.length > 0) {
      const first = faqItems[0];
      first.classList.add('active');
      const ans = first.querySelector('.faq-answer');
      if (ans) ans.style.maxHeight = ans.scrollHeight + 32 + 'px';
    }
  }

  // ==========================================
  // 3. INTERACTIVE WHATSAPP HUD SIMULATOR
  // ==========================================
  function initSimulator() {
    const timerEl = document.getElementById('sim-live-timer');
    const repliedBtn = document.getElementById('sim-replied-btn');
    if (!timerEl) return;

    let secondsLeft = 59 * 60 + 24; // 59m 24s initial countdown
    let isReplied = false;

    // Ticking countdown timer
    setInterval(() => {
      if (isReplied) return;
      if (secondsLeft > 0) {
        secondsLeft--;
        const m = Math.floor(secondsLeft / 60);
        const s = secondsLeft % 60;
        timerEl.textContent = `00h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
      } else {
        timerEl.textContent = `00h 00m 00s`;
      }
    }, 1000);

    // Click "✓ Replied" button simulation
    if (repliedBtn) {
      repliedBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isReplied = !isReplied;

        if (isReplied) {
          repliedBtn.textContent = '🎉 Replied!';
          repliedBtn.style.background = '#15803D';
          repliedBtn.style.color = '#FFFFFF';
          timerEl.textContent = 'Cleared';
          timerEl.style.color = '#15803D';
        } else {
          repliedBtn.textContent = '✓ Replied';
          repliedBtn.style.background = '#DCFCE7';
          repliedBtn.style.color = '#166534';
          secondsLeft = 59 * 60 + 24;
          timerEl.style.color = '#15803D';
        }
      });
    }

    // Chat list row selection highlight
    const chatRows = document.querySelectorAll('.wa-chat-row');
    chatRows.forEach((row) => {
      row.addEventListener('click', () => {
        chatRows.forEach((r) => r.classList.remove('active-demo-row'));
        row.classList.add('active-demo-row');
      });
    });
  }

  // ==========================================
  // 4. DESKTOP 3D MOUSE PARALLAX TILT
  // ==========================================
  function init3DTilt() {
    // Only enable on desktop with hover capability
    if (window.matchMedia('(hover: none) or (max-width: 992px)').matches) {
      return;
    }

    const tiltElements = document.querySelectorAll('[data-tilt]');

    tiltElements.forEach((el) => {
      let isHovered = false;
      let targetX = 0;
      let targetY = 0;
      let currentX = 0;
      let currentY = 0;
      let animationFrame = null;

      const updateTransform = () => {
        if (!isHovered) {
          // Spring smoothly back to center
          currentX += (0 - currentX) * 0.12;
          currentY += (0 - currentY) * 0.12;
          if (Math.abs(currentX) < 0.05 && Math.abs(currentY) < 0.05) {
            el.style.transform = '';
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
            return;
          }
        } else {
          currentX += (targetX - currentX) * 0.12;
          currentY += (targetY - currentY) * 0.12;
        }

        el.style.transform = `perspective(1000px) rotateX(${currentY}deg) rotateY(${currentX}deg)`;
        animationFrame = requestAnimationFrame(updateTransform);
      };

      el.addEventListener('mouseenter', () => {
        isHovered = true;
        if (!animationFrame) {
          animationFrame = requestAnimationFrame(updateTransform);
        }
      });

      el.addEventListener('mousemove', (e) => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        // Max 4 degrees tilt
        targetX = ((x - centerX) / centerX) * 3.5;
        targetY = -((y - centerY) / centerY) * 3.5;
      });

      el.addEventListener('mouseleave', () => {
        isHovered = false;
        targetX = 0;
        targetY = 0;
      });
    });
  }

  // ==========================================
  // 5. LOW-CPU AMBIENT BACKGROUND CANVAS
  // ==========================================
  function initAmbientCanvas() {
    const canvas = document.getElementById('ambient-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);
    let isTabVisible = !document.hidden;
    let animId = null;

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    document.addEventListener('visibilitychange', () => {
      isTabVisible = !document.hidden;
      if (isTabVisible && !animId) {
        animId = requestAnimationFrame(render);
      } else if (!isTabVisible && animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    });

    // Gentle floating nodes
    const nodeCount = Math.min(22, Math.floor(window.innerWidth / 70));
    const nodes = [];

    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 2 + 1,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        alpha: Math.random() * 0.25 + 0.1
      });
    }

    function render() {
      if (!isTabVisible) return;

      ctx.clearRect(0, 0, width, height);

      // Draw faint connections
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx;
        n.y += n.vy;

        if (n.x < 0) n.x = width;
        if (n.x > width) n.x = 0;
        if (n.y < 0) n.y = height;
        if (n.y > height) n.y = 0;

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(18, 140, 126, ${n.alpha})`;
        ctx.fill();

        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          const dist = Math.hypot(n.x - n2.x, n.y - n2.y);
          if (dist < 140) {
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(n2.x, n2.y);
            ctx.strokeStyle = `rgba(18, 140, 126, ${0.12 * (1 - dist / 140)})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);
  }

  // ==========================================
  // INITIALIZATION ON DOM READY
  // ==========================================
  document.addEventListener('DOMContentLoaded', () => {
    initFaq();
    initSimulator();
    init3DTilt();
    initAmbientCanvas();
  });
})();
