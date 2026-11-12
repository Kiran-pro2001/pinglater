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
  // 4. DESKTOP 3D MOUSE PARALLAX TILT WITH SPECULAR GLOW
  // ==========================================
  function init3DTilt() {
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
          currentX += (0 - currentX) * 0.12;
          currentY += (0 - currentY) * 0.12;
          if (Math.abs(currentX) < 0.04 && Math.abs(currentY) < 0.04) {
            el.style.transform = '';
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
            return;
          }
        } else {
          currentX += (targetX - currentX) * 0.12;
          currentY += (targetY - currentY) * 0.12;
        }

        el.style.transform = `perspective(1100px) rotateX(${currentY}deg) rotateY(${currentX}deg) translateZ(10px)`;
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

        targetX = ((x - centerX) / centerX) * 4.5;
        targetY = -((y - centerY) / centerY) * 4.5;
      });

      el.addEventListener('mouseleave', () => {
        isHovered = false;
        targetX = 0;
        targetY = 0;
      });
    });
  }

  // ==========================================
  // 5. THEME-DRIVEN 3D AMBIENT WHATSAPP SALES HUD CANVAS
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

    let mouseX = width / 2;
    let mouseY = height / 2;
    let targetMouseX = mouseX;
    let targetMouseY = mouseY;

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      if (width <= 768 && animId) {
        cancelAnimationFrame(animId);
        animId = null;
      } else if (width > 768 && !animId && isTabVisible) {
        animId = requestAnimationFrame(render);
      }
    });

    window.addEventListener('mousemove', (e) => {
      targetMouseX = e.clientX;
      targetMouseY = e.clientY;
    });

    document.addEventListener('visibilitychange', () => {
      isTabVisible = !document.hidden;
      if (isTabVisible && !animId && window.innerWidth > 768) {
        animId = requestAnimationFrame(render);
      } else if (!isTabVisible && animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    });

    // 3D Floating HUD Token Definitions (PingLater Theme + ICP Outcome Tokens)
    const tokenPresets = [
      // Direct ROI & Target ICP Outcomes
      { type: 'pill', icon: '🎉', label: 'Converted Lead in 48h', sub: 'Outcome', color: '#15803D' },
      { type: 'pill', icon: '💰', label: 'Closed ₹50,000 Deal', sub: 'Revenue', color: '#075E54' },
      { type: 'pill', icon: '🚀', label: '0 Ghosted Leads', sub: 'Outcome', color: '#128C7E' },
      { type: 'pill', icon: '🤝', label: 'Paid Client Signed', sub: 'Closed', color: '#15803D' },
      // Core Features & Anti-Ban Controls
      { type: 'pill', icon: '⏳', label: '24h Timer Active', sub: 'Awaiting', color: '#128C7E' },
      { type: 'pill', icon: '⚡', label: '/pricing-pitch', sub: 'Snippet', color: '#075E54' },
      { type: 'pill', icon: '🎯', label: 'Step 2 Due Today', sub: 'Cadence', color: '#D97706' },
      { type: 'tick', icon: '✓✓', label: 'Read', sub: '', color: '#25D366' },
      { type: 'pill', icon: '🛡️', label: '100% Anti-Ban Safe', sub: '0% Risk', color: '#128C7E' },
      { type: 'pill', icon: '⚡', label: '1-Sec Follow-Up Sent', sub: 'Speed', color: '#075E54' },
      { type: 'tick', icon: '✓✓', label: 'Auto-Halted', sub: '', color: '#25D366' },
      { type: 'pill', icon: '⏳', label: '59m 24s Countdown', sub: 'Live', color: '#128C7E' },
    ];

    // Helper to calculate the hero text exclusion zone (keeps tokens out of the reading path)
    function getHeroExclusion() {
      const headline = document.querySelector('.hero-headline');
      const subhead = document.querySelector('.hero-subhead');
      const ctaGroup = document.querySelector('.hero-cta-group');
      if (!headline) return null;

      const hRect = headline.getBoundingClientRect();
      const sRect = subhead ? subhead.getBoundingClientRect() : hRect;
      const cRect = ctaGroup ? ctaGroup.getBoundingClientRect() : sRect;

      // Only active if hero section is currently visible in viewport
      if (cRect.bottom < 0 || hRect.top > height) return null;

      const bufferX = 65; // Safe padding outside headline/subhead margins
      const bufferY = 35; // Safe padding above headline and below CTAs

      const left = Math.min(hRect.left, sRect.left) - bufferX;
      const right = Math.max(hRect.right, sRect.right) + bufferX;
      const top = Math.max(76, hRect.top - bufferY);
      const bottom = cRect.bottom + bufferY;

      return {
        left,
        right,
        top,
        bottom,
        centerX: (left + right) / 2,
        centerY: (top + bottom) / 2,
        halfW: (right - left) / 2,
        halfH: (bottom - top) / 2
      };
    }

    const tokens = tokenPresets.map((preset, idx) => {
      const zone = idx % 4;
      let startX, startY;

      if (zone === 0) {
        // Left Margin Zone
        startX = 35 + Math.random() * (width * 0.18);
        startY = 90 + Math.random() * (height * 0.75);
      } else if (zone === 1) {
        // Right Margin Zone
        startX = width - 40 - Math.random() * (width * 0.18);
        startY = 90 + Math.random() * (height * 0.75);
      } else if (zone === 2) {
        // Top Perimeter Zone (above headline)
        startX = width * 0.15 + Math.random() * (width * 0.7);
        startY = 50 + Math.random() * 80;
      } else {
        // Bottom Perimeter Zone (below CTA buttons)
        startX = width * 0.15 + Math.random() * (width * 0.7);
        startY = height * 0.75 + Math.random() * (height * 0.18);
      }

      return {
        ...preset,
        x: startX,
        y: startY,
        z: 0.35 + Math.random() * 0.65, // Z-depth layer (0.35 = background, 1.0 = foreground)
        vx: (zone === 0 ? -0.15 : zone === 1 ? 0.15 : (Math.random() - 0.5) * 0.25),
        vy: (Math.random() - 0.5) * 0.25,
        floatPhase: Math.random() * Math.PI * 2,
        floatSpeed: 0.0015 + Math.random() * 0.0015,
        alpha: 0.22 + Math.random() * 0.18
      };
    });

    // Radar Ping Waves (Concentric sonar pulses)
    const radarPings = [
      { x: width * 0.25, y: height * 0.35, radius: 20, maxRadius: 280, speed: 0.45, alpha: 0.12 },
      { x: width * 0.75, y: height * 0.65, radius: 100, maxRadius: 320, speed: 0.35, alpha: 0.10 }
    ];

    let lastTime = performance.now();

    function render(now) {
      if (!isTabVisible) return;
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      ctx.clearRect(0, 0, width, height);

      // Smooth mouse lerp
      mouseX += (targetMouseX - mouseX) * 0.05;
      mouseY += (targetMouseY - mouseY) * 0.05;

      const mouseOffsetFactorX = (mouseX - width / 2) / (width / 2);
      const mouseOffsetFactorY = (mouseY - height / 2) / (height / 2);

      // 1. Draw Radar Sonar Waves (Signaling Anti-Ban Lead Tracking)
      radarPings.forEach((ping) => {
        ping.radius += ping.speed;
        if (ping.radius > ping.maxRadius) {
          ping.radius = 10;
        }
        const progress = ping.radius / ping.maxRadius;
        const currentAlpha = ping.alpha * (1 - progress);

        ctx.save();
        ctx.beginPath();
        ctx.arc(ping.x, ping.y, ping.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(18, 140, 126, ${currentAlpha})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Inner harmonic ring
        if (ping.radius > 60) {
          ctx.beginPath();
          ctx.arc(ping.x, ping.y, ping.radius * 0.6, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(37, 211, 102, ${currentAlpha * 0.6})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        ctx.restore();
      });

      // 2. Draw Floating 3D HUD Tokens with Parallax Depth (Steering around text)
      const ex = getHeroExclusion();

      tokens.forEach((t) => {
        t.x += t.vx;
        t.y += t.vy;

        // Wrap around outer screen boundaries
        if (t.x < 25) t.x = width - 35;
        if (t.x > width - 25) t.x = 35;
        if (t.y < 30) t.y = height - 35;
        if (t.y > height - 30) t.y = 35;

        // Deflect away from central Hero Text (Keeping headline & subtitle 100% clean)
        if (ex) {
          const dx = t.x - ex.centerX;
          const dy = t.y - ex.centerY;
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);

          // Hard exclusion: If inside the text boundary, immediately push into the nearest outer margin
          if (absDx < ex.halfW && absDy < ex.halfH) {
            const overlapX = ex.halfW - absDx;
            const overlapY = ex.halfH - absDy;

            if (overlapX < overlapY) {
              const signX = dx >= 0 ? 1 : -1;
              t.x = ex.centerX + signX * (ex.halfW + 12);
              t.vx = signX * Math.max(0.35, Math.abs(t.vx));
            } else {
              const signY = dy >= 0 ? 1 : -1;
              t.y = ex.centerY + signY * (ex.halfH + 12);
              t.vy = signY * Math.max(0.3, Math.abs(t.vy));
            }
          } else if (absDx < ex.halfW + 55 && absDy < ex.halfH + 45) {
            // Soft aerodynamic deflection: gently curve badges around the outer margins of the text
            const pushFactor = 0.025;
            t.vx += (dx / ex.halfW) * pushFactor;
            t.vy += (dy / ex.halfH) * pushFactor;
            t.vx = Math.max(-0.6, Math.min(0.6, t.vx));
            t.vy = Math.max(-0.5, Math.min(0.5, t.vy));
          }
        }

        const floatY = Math.sin(now * t.floatSpeed + t.floatPhase) * (10 * t.z);
        const parallaxX = mouseOffsetFactorX * (35 * t.z);
        const parallaxY = mouseOffsetFactorY * (25 * t.z);

        const renderX = t.x + parallaxX;
        const renderY = t.y + floatY + parallaxY;
        const scale = 0.75 + t.z * 0.35;

        ctx.save();
        ctx.translate(renderX, renderY);
        ctx.scale(scale, scale);

        if (t.type === 'tick') {
          // Double tick checkmark badge
          ctx.font = '700 15px -apple-system, sans-serif';
          ctx.fillStyle = `rgba(37, 211, 102, ${t.alpha * 1.5})`;
          ctx.shadowColor = 'rgba(37, 211, 102, 0.4)';
          ctx.shadowBlur = 8;
          ctx.fillText(t.icon, -10, 5);
        } else {
          // Frosted 3D HUD Pill
          const pillWidth = 115;
          const pillHeight = 28;
          const radius = 14;

          // Shadow
          ctx.shadowColor = 'rgba(18, 140, 126, 0.14)';
          ctx.shadowBlur = 12 * t.z;
          ctx.shadowOffsetY = 4 * t.z;

          // Pill Background
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(-pillWidth / 2, -pillHeight / 2, pillWidth, pillHeight, radius);
          } else {
            ctx.rect(-pillWidth / 2, -pillHeight / 2, pillWidth, pillHeight);
          }
          ctx.fillStyle = `rgba(255, 255, 255, ${0.72 + t.z * 0.22})`;
          ctx.fill();

          // Pill Border
          ctx.strokeStyle = `rgba(18, 140, 126, ${0.18 + t.z * 0.15})`;
          ctx.lineWidth = 1;
          ctx.stroke();

          // Clear shadow for crisp text
          ctx.shadowColor = 'transparent';

          // Icon
          ctx.font = '12px -apple-system, sans-serif';
          ctx.fillText(t.icon, -pillWidth / 2 + 10, 4);

          // Label
          ctx.font = '600 11px -apple-system, sans-serif';
          ctx.fillStyle = t.color;
          ctx.fillText(t.label, -pillWidth / 2 + 28, 4);
        }

        ctx.restore();
      });

      animId = requestAnimationFrame(render);
    }

    // Only start ambient floating canvas on desktop screens (>768px)
    if (window.innerWidth > 768) {
      animId = requestAnimationFrame(render);
    }
  }

  // ==========================================
  // MOBILE STICKY ACTION BAR
  // ==========================================
  function initMobileStickyBar() {
    const stickyBar = document.getElementById('mobileStickyBar');
    if (!stickyBar) return;

    let isVisible = false;
    window.addEventListener(
      'scroll',
      () => {
        const shouldShow = window.scrollY > 280;
        if (shouldShow !== isVisible) {
          isVisible = shouldShow;
          if (isVisible) {
            stickyBar.classList.add('visible');
          } else {
            stickyBar.classList.remove('visible');
          }
        }
      },
      { passive: true }
    );
  }

  // ==========================================
  // INITIALIZATION ON DOM READY
  // ==========================================
  document.addEventListener('DOMContentLoaded', () => {
    initFaq();
    initSimulator();
    init3DTilt();
    initAmbientCanvas();
    initMobileStickyBar();
  });
})();
