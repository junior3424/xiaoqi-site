/* ============================================================
   小七 · GUIDE Nº01 v2 —— 渐进增强脚本（无依赖）
   ------------------------------------------------------------
   只有两个交互（规格 §4.4）：
     主：账本重放 —— 播放/暂停 + 时间轴 + 单步，右侧状态卡每次重算
     辅：漏斗开关 —— aria-pressed 切换「显示被筛掉的 9 条」
   纪律：
   · 无 JS 时页面完整可读（前 5 行 + 终态数字由 CSS/HTML 给出），本文件只是增强
   · 零滚动触发动画：不监听 scroll、不加任何入场类、不做元素观察
   · prefers-reduced-motion 下不自动播放（本页本来也不自动播放）
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;
  if (!root.classList.contains('js')) return;

  /* ---------------- 主互动：账本重放 ---------------- */
  var list = document.getElementById('evlist');
  var play = document.getElementById('lplay');
  var prev = document.getElementById('lprev');
  var next = document.getElementById('lnext');
  var range = document.getElementById('lrange');
  var posLabel = document.getElementById('ledger-pos');

  if (list && play && range) {
    var rows = Array.prototype.slice.call(list.children);
    var total = rows.length;
    var timer = null;

    // 状态机与 tb.mjs 一致：new→open / claim→claimed / done→done / deliver→delivered / abandon→abandoned
    // artifact、note、handoff 是「记录」，不改状态——所以 done 之后再来的 note 不会把任务改回进行中。
    var NEXT = { new: 'open', claim: 'claimed', done: 'done', deliver: 'delivered', abandon: 'abandoned' };
    var CLOSED = { done: 1, delivered: 1 };

    function recompute(pos) {
      var st = Object.create(null);
      var events = 0, arts = 0;
      for (var i = 0; i < pos; i++) {
        var r = rows[i];
        var t = r.getAttribute('data-task');
        var ty = r.getAttribute('data-type');
        if (NEXT[ty]) st[t] = NEXT[ty];
        else if (!st[t]) st[t] = 'open';      // 首条就是记录类事件时，按 open 起算
        events++;
        if (ty === 'artifact') arts++;
      }
      var tasks = 0, closed = 0;
      for (var k in st) {
        tasks++;
        if (CLOSED[st[k]]) closed++;
      }
      return { events: events, tasks: tasks, closed: closed, arts: arts };
    }

    function paint(pos) {
      for (var i = 0; i < total; i++) {
        rows[i].hidden = i >= pos;
      }
      var s = recompute(pos);
      ['events', 'tasks', 'closed', 'arts'].forEach(function (k) {
        var el = document.querySelector('[data-k="' + k + '"]');
        if (el) el.textContent = String(s[k]);
      });
      if (posLabel) posLabel.textContent = pos + ' / ' + total + ' 行';
      range.value = String(pos);
      range.setAttribute('aria-valuetext', '显示到第 ' + pos + ' 条，共 ' + total + ' 条');
      prev.disabled = pos <= 0;
      next.disabled = pos >= total;
      if (pos >= total) stop();
    }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      play.textContent = '播放';
      play.setAttribute('aria-label', '从第一条开始重放');
    }

    function tick() {
      var pos = Number(range.value);
      if (pos >= total) { stop(); return; }
      paint(pos + 1);
    }

    function start() {
      if (Number(range.value) >= total) paint(0);
      if (timer) return;
      play.textContent = '暂停';
      play.setAttribute('aria-label', '暂停重放');
      timer = setInterval(tick, 220);
    }

    play.addEventListener('click', function () {
      if (timer) stop(); else start();
    });
    prev.addEventListener('click', function () { stop(); paint(Math.max(0, Number(range.value) - 1)); });
    next.addEventListener('click', function () { stop(); paint(Math.min(total, Number(range.value) + 1)); });
    range.addEventListener('input', function () { stop(); paint(Number(range.value)); });
    range.setAttribute('aria-label', '账本时间轴：拖动显示到第几条');
    range.setAttribute('aria-valuemin', '0');
    range.setAttribute('aria-valuemax', String(total));

    paint(total); // 首屏给终态，读者先看到完整账本
  }

  /* ---------------- 辅互动：漏斗开关 ---------------- */
  var funnel = document.getElementById('funnel');
  var toggle = document.getElementById('funnel-toggle');
  if (funnel && toggle) {
    toggle.addEventListener('click', function () {
      var on = toggle.getAttribute('aria-pressed') === 'true';
      toggle.setAttribute('aria-pressed', on ? 'false' : 'true');
      funnel.classList.toggle('is-open', !on);
    });
  }
})();
