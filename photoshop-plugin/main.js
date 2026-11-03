/* GFX References — Photoshop UXP 패널
 *
 * - 레퍼런스 검색 (분류 / 색 / 태그 / 정렬)
 * - "새 레이어로 불러오기": 서버가 디스코드 아카이브에서 원본을 가져오고,
 *   플러그인이 임시 폴더에 저장한 뒤 현재 문서에 고급 개체(Smart Object) 레이어로 배치
 * - 팔레트 색을 누르면 전경색으로 설정
 * - 디스코드 연동: 패널에 표시된 코드를 디스코드에서 /연동 코드:XXXX-XXXX 로 입력
 */

// 포토샵 밖(일반 브라우저)에서도 UI 를 확인할 수 있도록 require 가 없으면 null
const hasRequire = typeof require === 'function';
const uxp = hasRequire ? require('uxp') : null;
const ps = hasRequire ? require('photoshop') : null;

const KEYS = { server: 'gfx.server', token: 'gfx.token', user: 'gfx.user' };
const PAGE_SIZE = 20;

const state = {
  server: (localStorage.getItem(KEYS.server) || '').replace(/\/+$/, ''),
  token: localStorage.getItem(KEYS.token) || '',
  user: safeJson(localStorage.getItem(KEYS.user)),
  meta: null,
  page: 0,
  hasMore: false,
  loading: false,
  current: null,
  linkTimer: null,
  searchSeq: 0,
  seed: '',
};

const $ = (id) => document.getElementById(id);

function safeJson(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function show(view) {
  ['view-setup', 'view-main', 'view-detail', 'view-link'].forEach((v) => $(v).classList.toggle('hidden', v !== view));
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

function qs(params) {
  const parts = [];
  Object.keys(params).forEach((k) => {
    const v = params[k];
    if (v === undefined || v === null || v === '') return;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  });
  return parts.length ? '?' + parts.join('&') : '';
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, opts) {
  opts = opts || {};
  const headers = {};
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(state.server + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (opts.raw) return res;
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* 본문 없음 */
  }
  if (!res.ok) {
    if (res.status === 401 && state.token) logout(false);
    throw new ApiError((data && data.error) || '요청 실패 (' + res.status + ')', res.status);
  }
  return data;
}

// ── 서버 설정 ──────────────────────────────────────────

async function connect(url) {
  const clean = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(clean)) throw new Error('http:// 또는 https:// 로 시작하는 주소를 입력해 주세요.');
  const prev = state.server;
  state.server = clean;
  try {
    state.meta = await api('/api/meta');
  } catch (e) {
    state.server = prev;
    throw new Error('서버에 연결할 수 없어요: ' + e.message);
  }
  localStorage.setItem(KEYS.server, clean);
  fillFilters();
  renderAccount();
  show('view-main');
  search(true);
}

function fillFilters() {
  const m = state.meta;
  const fill = (select, first, items) => {
    select.innerHTML = '';
    const o = el('option', null, first);
    o.value = '';
    select.appendChild(o);
    items.forEach((it) => {
      const opt = el('option', null, it.label);
      opt.value = it.value;
      select.appendChild(opt);
    });
  };
  fill(
    $('category'),
    '전체 분류',
    m.categories.map((c) => ({ value: c.key, label: c.label })),
  );
  fill(
    $('color'),
    '모든 색',
    m.colors.map((c) => ({ value: c.key, label: c.label })),
  );
  fill(
    $('tag'),
    '모든 태그',
    m.tags.map((t) => ({ value: t.name, label: '#' + t.name + ' (' + t.count + ')' })),
  );
  $('react').textContent = (m.reactions && m.reactions[0]) || '⭐';
}

// ── 계정 ───────────────────────────────────────────────

function renderAccount() {
  const box = $('account');
  box.innerHTML = '';
  if (state.user && state.token) {
    if (state.user.avatarUrl) {
      const img = el('img');
      img.src = state.user.avatarUrl;
      box.appendChild(img);
    }
    box.appendChild(el('span', null, state.user.displayName || state.user.username));
    const out = el('button', 'link', '연동 해제');
    out.addEventListener('click', () => logout(true));
    box.appendChild(out);
  } else {
    const btn = el('button', 'link', '🔗 디스코드 연동');
    btn.addEventListener('click', () => openLink());
    box.appendChild(btn);
  }
}

function logout(callServer) {
  if (callServer && state.token) api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
  state.token = '';
  state.user = null;
  localStorage.removeItem(KEYS.token);
  localStorage.removeItem(KEYS.user);
  renderAccount();
}

let afterLink = null;
function openLink(then) {
  afterLink = then || null;
  $('link-body').innerHTML = '';
  const start = el('button', 'primary block', '연동 코드 받기');
  start.id = 'start-link';
  start.addEventListener('click', startLink);
  $('link-body').appendChild(start);
  show('view-link');
}

async function startLink() {
  const body = $('link-body');
  body.innerHTML = '';
  body.appendChild(el('p', 'dim', '코드를 받는 중…'));
  try {
    const res = await api('/api/auth/device', { method: 'POST', body: { client: 'plugin' } });
    body.innerHTML = '';
    body.appendChild(el('p', null, '디스코드 아무 채널에서 아래 명령어를 입력하세요:'));
    body.appendChild(el('div', 'code', res.userCode));
    body.appendChild(el('p', 'small', res.command));
    body.appendChild(el('p', 'small dim', '승인을 기다리는 중… (10분 안에 입력해 주세요)'));
    const started = Date.now();
    clearInterval(state.linkTimer);
    state.linkTimer = setInterval(async () => {
      if (Date.now() - started > 10 * 60 * 1000) {
        clearInterval(state.linkTimer);
        body.innerHTML = '';
        body.appendChild(el('p', 'error', '코드가 만료되었어요. 다시 시도해 주세요.'));
        return;
      }
      try {
        const r = await api('/api/auth/device/poll', { method: 'POST', body: { deviceCode: res.deviceCode } });
        if (r.status === 'approved' && r.token) {
          clearInterval(state.linkTimer);
          state.token = r.token;
          state.user = r.user;
          localStorage.setItem(KEYS.token, r.token);
          localStorage.setItem(KEYS.user, JSON.stringify(r.user));
          renderAccount();
          toast('연동 완료! ' + ((r.user && (r.user.displayName || r.user.username)) || ''));
          const next = afterLink;
          afterLink = null;
          if (next) next();
          else show('view-main');
        } else if (r.status !== 'pending') {
          clearInterval(state.linkTimer);
          body.innerHTML = '';
          body.appendChild(el('p', 'error', '코드가 만료되었어요. 다시 시도해 주세요.'));
        }
      } catch (e) {
        /* 다음 주기에 다시 시도 */
      }
    }, (res.interval || 3) * 1000);
  } catch (e) {
    body.innerHTML = '';
    body.appendChild(el('p', 'error', e.message));
    const retry = el('button', 'block', '다시 시도');
    retry.addEventListener('click', startLink);
    body.appendChild(retry);
  }
}

// ── 검색 ───────────────────────────────────────────────

function filters() {
  const sort = $('sort').value;
  return {
    q: $('q').value.trim(),
    category: $('category').value,
    color: $('color').value,
    tags: $('tag').value,
    sort: sort === 'newest' ? '' : sort,
    period: sort === 'popular' ? 'all' : '',
  };
}

async function search(reset) {
  if (state.loading && !reset) return;
  const seq = ++state.searchSeq;
  state.loading = true;
  if (reset) {
    state.seed = Math.random().toString(36).slice(2, 10);
    state.page = 0;
    $('results').innerHTML = '';
    $('count').textContent = '검색 중…';
  }
  try {
    const f = filters();
    f.page = state.page + 1;
    f.limit = PAGE_SIZE;
    if (f.sort === 'random') f.seed = state.seed;
    const data = await api('/api/refs' + qs(f));
    if (seq !== state.searchSeq) return;
    state.page += 1;
    state.hasMore = data.hasMore;
    $('count').textContent = data.total + '개의 레퍼런스';
    data.items.forEach((ref) => $('results').appendChild(thumb(ref)));
    if (!data.items.length && state.page === 1) $('results').appendChild(el('p', 'dim', '조건에 맞는 레퍼런스가 없어요.'));
    $('more').classList.toggle('hidden', !state.hasMore);
  } catch (e) {
    if (seq === state.searchSeq) $('count').textContent = e.message;
  } finally {
    if (seq === state.searchSeq) state.loading = false;
  }
}

function thumbUrl(ref, w) {
  return state.server + '/api/refs/' + ref.id + '/thumb?w=' + w;
}

function thumb(ref) {
  const box = el('div', 'thumb');
  const img = el('img');
  img.src = thumbUrl(ref, 320);
  img.alt = ref.title;
  box.appendChild(img);
  box.appendChild(el('div', 't', '#' + ref.id + ' ' + ref.title));
  box.appendChild(el('div', 's', (ref.mapName && ref.mapName !== ref.title ? ref.mapName + ' · ' : '') + ref.creator.name));
  box.addEventListener('click', () => openDetail(ref));
  return box;
}

async function randomRef() {
  try {
    const f = filters();
    const data = await api('/api/refs/random' + qs({ category: f.category, color: f.color, tags: f.tags }));
    openDetail(data.item);
  } catch (e) {
    toast(e.message);
  }
}

// ── 상세 ───────────────────────────────────────────────

function openDetail(ref) {
  state.current = ref;
  $('detail-id').textContent = '#' + ref.id + ' · ' + ref.categoryLabel;
  $('detail-img').src = thumbUrl(ref, 640);
  $('detail-title').textContent = ref.title;
  const meta = [];
  if (ref.mapName) meta.push('맵: ' + ref.mapName);
  meta.push('제작자: ' + ref.creator.name);
  meta.push(ref.width + '×' + ref.height);
  $('detail-meta').textContent = meta.join(' · ');
  const tags = $('detail-tags');
  tags.innerHTML = '';
  ref.tags.forEach((t) => tags.appendChild(el('span', null, '#' + t)));
  const pal = $('detail-palette');
  pal.innerHTML = '';
  ref.palette.forEach((p) => {
    const sw = el('div');
    sw.style.backgroundColor = p.hex;
    sw.title = p.hex + ' — 전경색으로 설정';
    sw.addEventListener('click', () => setForeground(p.hex));
    pal.appendChild(sw);
  });
  updateReactButton(ref);
  $('detail-status').textContent = '';
  show('view-detail');
}

function updateReactButton(ref) {
  const e = (state.meta.reactions && state.meta.reactions[0]) || '⭐';
  const mine = ref.myReactions && ref.myReactions.indexOf(e) >= 0;
  $('react').textContent = e + ' ' + (ref.reactions[e] || 0) + (mine ? ' (내 반응)' : '');
}

async function toggleReaction() {
  const ref = state.current;
  if (!ref) return;
  if (!state.token) return openLink(() => openDetail(ref));
  const e = (state.meta.reactions && state.meta.reactions[0]) || '⭐';
  try {
    const res = await api('/api/refs/' + ref.id + '/reactions', { method: 'POST', body: { emoji: e } });
    ref.reactions = res.reactions;
    ref.myReactions = res.myReactions;
    updateReactButton(ref);
  } catch (err) {
    toast(err.message);
  }
}

function openSite() {
  const ref = state.current;
  if (!ref) return;
  if (uxp && uxp.shell && uxp.shell.openExternal) uxp.shell.openExternal(ref.siteUrl, 'GFX References 사이트를 엽니다.');
  else window.open(ref.siteUrl, '_blank');
}

// ── 포토샵 연동 ────────────────────────────────────────

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/tiff': 'tif' };

/** 원본을 받아 임시 파일로 저장 (디스코드 아카이브 → 서버 → 플러그인) */
async function downloadOriginal(ref) {
  const res = await api('/api/refs/' + ref.id + '/original', { raw: true });
  if (res.status === 401) {
    logout(false);
    throw new ApiError('디스코드 연동이 필요해요.', 401);
  }
  if (!res.ok) {
    let msg = '원본을 받지 못했어요 (' + res.status + ')';
    try {
      msg = (await res.json()).error || msg;
    } catch (e) {
      /* */
    }
    throw new ApiError(msg, res.status);
  }
  const type = (res.headers.get('content-type') || 'image/png').split(';')[0];
  const buf = await res.arrayBuffer();
  const lfs = uxp.storage.localFileSystem;
  const folder = await lfs.getTemporaryFolder();
  const file = await folder.createFile('gfx-ref-' + ref.id + '.' + (EXT[type] || 'png'), { overwrite: true });
  await file.write(buf, { format: uxp.storage.formats.binary });
  return file;
}

async function bringIn(asNewDocument) {
  const ref = state.current;
  if (!ref) return;
  if (!ps || !uxp) return toast('포토샵 안에서만 사용할 수 있어요.');
  if (!state.token) return openLink(() => openDetail(ref));
  const status = $('detail-status');
  const buttons = [$('place'), $('open-doc')];
  buttons.forEach((b) => (b.disabled = true));
  status.textContent = '디스코드에서 원본을 가져오는 중…';
  try {
    const file = await downloadOriginal(ref);
    status.textContent = '포토샵으로 불러오는 중…';
    const { app, core, action } = ps;
    const layerName = '#' + ref.id + ' ' + ref.title + ' (' + ref.creator.name + ')';
    await core.executeAsModal(
      async () => {
        if (asNewDocument || app.documents.length === 0) {
          await app.open(file);
          return;
        }
        const token = uxp.storage.localFileSystem.createSessionToken(file);
        await action.batchPlay(
          [
            {
              _obj: 'placeEvent',
              null: { _path: token, _kind: 'local' },
              freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
              offset: {
                _obj: 'offset',
                horizontal: { _unit: 'pixelsUnit', _value: 0 },
                vertical: { _unit: 'pixelsUnit', _value: 0 },
              },
              _options: { dialogOptions: 'dontDisplay' },
            },
          ],
          {},
        );
        const layers = app.activeDocument && app.activeDocument.activeLayers;
        if (layers && layers[0]) layers[0].name = layerName;
      },
      { commandName: 'GFX 레퍼런스 불러오기' },
    );
    status.textContent = '';
    toast(asNewDocument ? '새 문서로 열었어요.' : '새 레이어로 불러왔어요: ' + layerName);
  } catch (e) {
    status.textContent = '';
    if (e.status === 401) openLink(() => openDetail(ref));
    else toast(e.message || String(e));
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function setForeground(hex) {
  if (!ps) return toast(hex);
  const { app, core, action } = ps;
  const n = parseInt(hex.replace('#', ''), 16);
  const rgb = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  try {
    await core.executeAsModal(
      async () => {
        try {
          const c = new app.SolidColor();
          c.rgb.red = rgb.r;
          c.rgb.green = rgb.g;
          c.rgb.blue = rgb.b;
          app.foregroundColor = c;
        } catch (e) {
          // 구버전 API 대비
          await action.batchPlay(
            [
              {
                _obj: 'set',
                _target: [{ _ref: 'color', _property: 'foregroundColor' }],
                to: { _obj: 'RGBColor', red: rgb.r, grain: rgb.g, blue: rgb.b },
                source: 'photoshopPicker',
                _options: { dialogOptions: 'dontDisplay' },
              },
            ],
            {},
          );
        }
      },
      { commandName: '전경색 설정' },
    );
    toast('전경색: ' + hex);
  } catch (e) {
    toast(e.message || String(e));
  }
}

// ── 이벤트 ─────────────────────────────────────────────

let searchTimer = null;
function debouncedSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => search(true), 400);
}

$('save-server').addEventListener('click', async () => {
  const err = $('setup-error');
  err.classList.add('hidden');
  try {
    await connect($('server-url').value);
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  }
});
$('open-settings').addEventListener('click', () => {
  $('server-url').value = state.server;
  show('view-setup');
});
$('q').addEventListener('input', debouncedSearch);
$('q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') search(true);
});
['category', 'color', 'tag', 'sort'].forEach((id) => $(id).addEventListener('change', () => search(true)));
$('more').addEventListener('click', () => search(false));
$('random').addEventListener('click', randomRef);
$('back').addEventListener('click', () => show('view-main'));
$('place').addEventListener('click', () => bringIn(false));
$('open-doc').addEventListener('click', () => bringIn(true));
$('react').addEventListener('click', toggleReaction);
$('open-site').addEventListener('click', openSite);
$('cancel-link').addEventListener('click', () => {
  clearInterval(state.linkTimer);
  show(state.current && afterLink ? 'view-detail' : 'view-main');
  afterLink = null;
});

// ── 시작 ───────────────────────────────────────────────

(async function init() {
  renderAccount();
  if (!state.server) {
    show('view-setup');
    return;
  }
  try {
    await connect(state.server);
  } catch (e) {
    $('server-url').value = state.server;
    $('setup-error').textContent = e.message;
    $('setup-error').classList.remove('hidden');
    show('view-setup');
  }
})();
