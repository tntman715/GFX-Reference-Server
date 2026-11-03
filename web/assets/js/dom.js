/** 작은 DOM 헬퍼: h('div.card', { onclick }, child, ...) */
export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const FALLBACK_AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2a2a38"/><circle cx="32" cy="25" r="11" fill="#6f6d82"/><path d="M12 56c3-11 11-17 20-17s17 6 20 17" fill="#6f6d82"/></svg>',
  );

/** 아바타 이미지를 못 불러오면 기본 아바타로 바꿈 */
document.addEventListener(
  'error',
  (e) => {
    const t = e.target;
    if (t instanceof HTMLImageElement && (t.classList.contains('avatar') || t.closest('.user-link')) && t.src !== FALLBACK_AVATAR) {
      t.src = FALLBACK_AVATAR;
    }
  },
  true,
);

export function avatarSrc(url) {
  return url || FALLBACK_AVATAR;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function toast(message, kind = '') {
  const root = document.getElementById('toasts');
  const el = h('div.toast', { class: kind }, message);
  root.append(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

export function spinner() {
  return h('div.spinner', { role: 'status', 'aria-label': '불러오는 중' });
}

export function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function fmtBytes(n) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
