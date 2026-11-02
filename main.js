/* ============================================================
   YAN — 个人作品档案 / 交互脚本
   无依赖，约 3KB。只在需要时启用动效。
   ============================================================ */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  /* ---------- 英雄区构成：鼠标视差 ---------- */
  const hero = document.getElementById('hero');
  const art = document.querySelector('.hero__art');
  const sup = document.querySelector('.stage');

  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (hero && art && sup && canHover && !reduceMotion) {
    let targetX = 0, targetY = 0;
    let curX = 0, curY = 0;
    let raf = 0;

    const render = () => {
      curX += (targetX - curX) * 0.08;
      curY += (targetY - curY) * 0.08;
      sup.style.transform =
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
})();
