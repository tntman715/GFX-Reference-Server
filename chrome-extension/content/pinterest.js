// 핀터레스트: 사진 위에 마우스를 올리면 왼쪽 위에 'GFX에 담기' 버튼을 띄웁니다.
// 핀터레스트 화면 구조가 바뀌어도 되도록, 마우스 아래에 있는 i.pinimg.com 사진을 직접 찾습니다.
(() => {
  if (window.__gfxBoxLoaded) return;
  window.__gfxBoxLoaded = true;

  const ko = (navigator.language || '').toLowerCase().startsWith('ko');
  const T = ko
    ? { save: 'GFX에 담기', saving: '담는 중…', saved: '✓ 담겼어요', exists: '이미 담겨 있어요', fail: '담지 못했어요', reload: '새로고침 후 다시 시도해 주세요' }
    : { save: 'Save to GFX', saving: 'Saving…', saved: '✓ Saved', exists: 'Already saved', fail: 'Could not save', reload: 'Reload the page and try again' };

  const MIN_SIZE = 120;

  // 핀터레스트 CSS 와 섞이지 않게 Shadow DOM 안에 버튼을 만듦
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483646;display:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      button {
        all: initial;
        font: 600 13px/1 system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif;
        color: #fff;
        background: #7b5cff;
        padding: 9px 12px;
        border-radius: 999px;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,.35);
        white-space: nowrap;
      }
      button:hover { background: #6a48ff; }
      button[data-state="saved"], button[data-state="exists"] { background: #1f9d55; }
      button[data-state="fail"] { background: #d64545; }
    </style>
    <button type="button"></button>`;
  const btn = shadow.querySelector('button');
  btn.textContent = T.save;
  document.documentElement.appendChild(host);

  let current = null; // 지금 버튼이 붙은 사진
  let busy = false;
  let hideTimer = null;
  let pending = false;

  function isPinImage(el) {
    if (!el || el.tagName !== 'IMG') return false;
    const src = el.currentSrc || el.src || '';
    if (!/^https:\/\/i\.pinimg\.com\//.test(src)) return false;
    const r = el.getBoundingClientRect();
    return r.width >= MIN_SIZE && r.height >= MIN_SIZE;
  }

  function imageAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === host) return current;
      if (isPinImage(el)) return el;
    }
    return null;
  }

  /** srcset 에서 가장 큰 주소 (없으면 src) */
  function bestSrc(img) {
    let best = img.currentSrc || img.src;
    let bestW = 0;
    (img.srcset || '').split(',').forEach((part) => {
      const [u, w] = part.trim().split(/\s+/);
      const n = parseFloat(w) || 0;
      if (u && n > bestW) {
        bestW = n;
        best = u;
      }
    });
    return best;
  }

  function pinPageUrl(img) {
    const a = img.closest('a[href*="/pin/"]');
    if (a) return new URL(a.getAttribute('href'), location.href).href;
    return location.href;
  }

  function place(img) {
    const r = img.getBoundingClientRect();
    host.style.transform = `translate(${Math.round(r.left + 10)}px, ${Math.round(r.top + 10)}px)`;
    host.style.display = 'block';
  }

  function show(img) {
    clearTimeout(hideTimer);
    if (img !== current) {
      current = img;
      if (!busy) {
        btn.textContent = T.save;
        btn.removeAttribute('data-state');
      }
    }
    place(img);
  }

  function hideSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (busy) return;
      host.style.display = 'none';
      current = null;
    }, 250);
  }

  document.addEventListener(
    'mousemove',
    (e) => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const img = imageAt(e.clientX, e.clientY);
        if (img) show(img);
        else hideSoon();
      });
    },
    { passive: true },
  );

  window.addEventListener(
    'scroll',
    () => {
      if (current && current.isConnected) place(current);
      else hideSoon();
    },
    { passive: true, capture: true },
  );

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!current || busy) return;
    const img = current;
    busy = true;
    btn.textContent = T.saving;
    btn.removeAttribute('data-state');
    let state = 'fail';
    let label = T.fail;
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'save',
        imageUrl: bestSrc(img),
        pageUrl: pinPageUrl(img),
        title: img.alt || '',
      });
      if (res && res.ok) {
        state = res.status === 'exists' ? 'exists' : 'saved';
        label = res.status === 'exists' ? T.exists : T.saved;
      }
    } catch {
      label = T.reload; // 익스텐션을 새로 불러온 뒤 이 탭을 새로고침하지 않은 경우
    }
    btn.textContent = label;
    btn.setAttribute('data-state', state);
    busy = false;
  });
})();
