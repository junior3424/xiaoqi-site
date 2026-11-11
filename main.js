/* ============================================================
   小七 — 个人站交互
   无依赖、无构建。只在需要时启用动效。
   1) 年份 2) 滚动进度 + 顶栏描边 3) 入场 4) 首屏视差 5) 移动目录
   ============================================================ */
(() => {
  'use strict';

  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mqMobile = window.matchMedia('(max-width: 680px)');

  /* ---------- 年份 ---------- */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- 顶部进度条 + 导航描边 ---------- */
  const progress = document.getElementById('progress');
  const masthead = document.getElementById('masthead');
  let ticking = false;

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (progress) progress.style.transform = `scaleX(${ratio.toFixed(4)})`;
      if (masthead) masthead.classList.toggle('is-scrolled', window.scrollY > 8);
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();

  /* ---------- 滚动入场 ---------- */
  const revealables = document.querySelectorAll('[data-reveal]');
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealables.forEach((el) => io.observe(el));
  } else {
    revealables.forEach((el) => el.classList.add('is-in'));
  }

  /* ---------- 首屏构成：鼠标视差 ---------- */
  const hero = document.getElementById('hero');
  const art = document.querySelector('.hero__art');
  const stage = document.querySelector('.stage');
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (hero && art && stage && canHover && !reduceMotion) {
    let targetX = 0, targetY = 0, curX = 0, curY = 0, raf = 0;

    const render = () => {
      curX += (targetX - curX) * 0.08;
      curY += (targetY - curY) * 0.08;
      stage.style.transform =
        `translate3d(${(curX * 16).toFixed(2)}px, ${(curY * 14).toFixed(2)}px, 0) rotate(${(curX * 1.4).toFixed(2)}deg)`;
      if (Math.abs(targetX - curX) > 0.001 || Math.abs(targetY - curY) > 0.001) {
        raf = requestAnimationFrame(render);
      } else {
        raf = 0;
      }
    };

    hero.addEventListener('mousemove', (e) => {
      const r = art.getBoundingClientRect();
      targetX = ((e.clientX - r.left) / r.width - 0.5) * 2;
      targetY = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(render);
    });

    hero.addEventListener('mouseleave', () => {
      targetX = 0; targetY = 0;
      if (!raf) raf = requestAnimationFrame(render);
    });
  }

  /* ---------- 网格 X 光：按住 G ---------- */
  const hud = document.getElementById('gridx-hud');
  const hudCols = document.getElementById('gridx-cols');
  const hudW = document.getElementById('gridx-w');
  const canType = (el) =>
    el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  if (hud && canHover) {
    const syncHud = () => {
      const cols = getComputedStyle(document.documentElement).getPropertyValue('--cols').trim() || '12';
      if (hudCols) hudCols.textContent = `${cols} COLS`;
      if (hudW) hudW.textContent = `${window.innerWidth}×${window.innerHeight}`;
    };

    const off = () => {
      root.classList.remove('gridx');
      window.removeEventListener('resize', syncHud);
    };

    const on = () => {
      syncHud();
      root.classList.add('gridx');
      window.addEventListener('resize', syncHud, { passive: true });
    };

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'g' && e.key !== 'G') return;
      if (e.metaKey || e.ctrlKey || e.altKey || canType(e.target)) return;
      if (root.classList.contains('gridx')) return;
      on();
    });
    document.addEventListener('keyup', (e) => {
      if (e.key === 'g' || e.key === 'G') off();
    });
    window.addEventListener('blur', off);
  }

  /* ---------- 移动端目录 ---------- */
  const toggle = document.getElementById('menu-toggle');
  const drawer = document.getElementById('drawer');

  if (toggle && drawer) {
    const focusables = () => drawer.querySelectorAll('a[href]');
    let lastFocus = null;

    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      drawer.classList.toggle('is-open', open);
      drawer.setAttribute('aria-hidden', String(!open));
      root.classList.toggle('menu-open', open);

      if (open) {
        lastFocus = document.activeElement;
        const first = focusables()[0];
        if (first) first.focus({ preventScroll: true });
      } else if (lastFocus && typeof lastFocus.focus === 'function') {
        lastFocus.focus({ preventScroll: true });
      }
    };

    toggle.addEventListener('click', () => {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    // 点目录里的链接：先收起，再跳转
    drawer.addEventListener('click', (e) => {
      if (e.target.closest('a[href]')) setOpen(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus({ preventScroll: true });
        return;
      }
      if (e.key !== 'Tab' || toggle.getAttribute('aria-expanded') !== 'true') return;

      // 焦点圈定在目录内
      const items = [toggle, ...focusables()];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    });

    // 放大到桌面尺寸时自动收起
    const onMq = (ev) => { if (!ev.matches) setOpen(false); };
    if (mqMobile.addEventListener) mqMobile.addEventListener('change', onMq);
    else if (mqMobile.addListener) mqMobile.addListener(onMq);
  }
})();
