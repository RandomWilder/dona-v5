// #267. The wide split inbox sizes the list from the line between it and the preview.
// One script body is the drag math the page runs and the math the tests call.
import { Html } from '../../kernel/ui/html.ts';

export const SPLIT_INBOX_KEY = 'dona.calls.split-inbox';
export const SPLIT_INBOX_MIN_REM = 16;
export const SPLIT_INBOX_DEFAULT_REM = 22;
export const SPLIT_PREVIEW_MIN_REM = 20;
export const SPLIT_KEY_STEP_REM = 1;
export const SPLIT_KEY_SHIFT_REM = 4;

const resizeFns = `function inboxDragDelta(rtl, startX, clientX) {
  return rtl ? startX - clientX : clientX - startX;
}
function inboxWidth(startWidth, delta, minInbox, maxInbox) {
  var next = startWidth + delta;
  var lower = Math.max(minInbox, next);
  return Math.round(Math.min(maxInbox, lower));
}`;

const loaded = new Function(`${resizeFns}
return { inboxDragDelta: inboxDragDelta, inboxWidth: inboxWidth };`)() as {
  inboxDragDelta: (rtl: boolean, startX: number, clientX: number) => number;
  inboxWidth: (
    startWidth: number,
    delta: number,
    minInbox: number,
    maxInbox: number,
  ) => number;
};

export const inboxDragDelta = loaded.inboxDragDelta;
export const inboxWidth = loaded.inboxWidth;

export function splitResizeHandle(): Html {
  return new Html(
    '<div class="split-resize" data-split-resize role="separator" aria-orientation="vertical" aria-label="רוחב רשימת הקריאות" tabindex="0"></div>',
  );
}

export function splitResizeScript(): Html {
  return new Html(`<script>
${resizeFns}
(function () {
  var handle = document.querySelector('[data-split-resize]');
  var work = handle && handle.closest('.split-work');
  var inbox = work && work.querySelector(':scope > .sheet');
  if (!handle || !work || !inbox) return;
  var key = ${JSON.stringify(SPLIT_INBOX_KEY)};
  var minRem = ${SPLIT_INBOX_MIN_REM};
  var previewRem = ${SPLIT_PREVIEW_MIN_REM};
  var stepRem = ${SPLIT_KEY_STEP_REM};
  var shiftRem = ${SPLIT_KEY_SHIFT_REM};
  function rem(n) {
    return n * parseFloat(getComputedStyle(document.documentElement).fontSize);
  }
  function live() {
    var layout = work.closest('.split-layout');
    return !!layout && getComputedStyle(layout).display !== 'none';
  }
  function limits() {
    var minInbox = rem(minRem);
    var maxInbox = work.getBoundingClientRect().width - handle.getBoundingClientRect().width - rem(previewRem);
    if (maxInbox < minInbox) maxInbox = minInbox;
    return { minInbox: minInbox, maxInbox: maxInbox };
  }
  function read() {
    try {
      var saved = Number(localStorage.getItem(key));
      return saved > 0 ? saved : 0;
    } catch {
      return 0;
    }
  }
  function remember(px) {
    try { localStorage.setItem(key, String(px)); } catch { /* private mode */ }
  }
  function paint(px) {
    var bound = limits();
    var next = inboxWidth(px, 0, bound.minInbox, bound.maxInbox);
    work.style.setProperty('--split-inbox', next + 'px');
    handle.setAttribute('aria-valuemin', String(Math.round(bound.minInbox)));
    handle.setAttribute('aria-valuemax', String(Math.round(bound.maxInbox)));
    handle.setAttribute('aria-valuenow', String(next));
    return next;
  }
  function markCurrent() {
    var bound = limits();
    handle.setAttribute('aria-valuemin', String(Math.round(bound.minInbox)));
    handle.setAttribute('aria-valuemax', String(Math.round(bound.maxInbox)));
    handle.setAttribute('aria-valuenow', String(Math.round(inbox.getBoundingClientRect().width)));
  }
  if (live()) {
    var saved = read();
    if (saved) paint(saved);
    else markCurrent();
  }
  handle.addEventListener('pointerdown', function (event) {
    if (!live() || event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    var startX = event.clientX;
    var startW = inbox.getBoundingClientRect().width;
    var rtl = getComputedStyle(work).direction === 'rtl';
    var body = document.body;
    var select = body.style.userSelect;
    var cursor = body.style.cursor;
    body.style.userSelect = 'none';
    body.style.cursor = 'ew-resize';
    function move(e) {
      var bound = limits();
      var next = inboxWidth(startW, inboxDragDelta(rtl, startX, e.clientX), bound.minInbox, bound.maxInbox);
      work.style.setProperty('--split-inbox', next + 'px');
      handle.setAttribute('aria-valuenow', String(next));
      handle.setAttribute('aria-valuemax', String(Math.round(bound.maxInbox)));
    }
    function end() {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      body.style.userSelect = select;
      body.style.cursor = cursor;
      var now = Number(handle.getAttribute('aria-valuenow'));
      if (now > 0) remember(now);
    }
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
  handle.addEventListener('keydown', function (event) {
    if (!live() || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    var rtl = getComputedStyle(work).direction === 'rtl';
    var step = rem(event.shiftKey ? shiftRem : stepRem);
    var delta = event.key === 'ArrowLeft' ? (rtl ? step : -step) : (rtl ? -step : step);
    var bound = limits();
    var next = inboxWidth(inbox.getBoundingClientRect().width, delta, bound.minInbox, bound.maxInbox);
    work.style.setProperty('--split-inbox', next + 'px');
    handle.setAttribute('aria-valuemin', String(Math.round(bound.minInbox)));
    handle.setAttribute('aria-valuemax', String(Math.round(bound.maxInbox)));
    handle.setAttribute('aria-valuenow', String(next));
    remember(next);
  });
  window.addEventListener('resize', function () {
    if (!live()) return;
    var saved = read();
    if (saved) paint(saved);
    else {
      work.style.removeProperty('--split-inbox');
      markCurrent();
    }
  });
})();
</script>`);
}
