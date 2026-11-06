// 보관함 화면: 담은 사진 보기 · 고르기 · GFX References 에 올리기
import { deleteItems, fetchImage, hostOf, listItems, updateItem } from './lib/box.js';

const core = globalThis.GFXRef.core;
const client = core.createClient({ storage: core.storage.local('gfx.'), clientName: 'plugin' });

// ── 글자 ────────────────────────────────────────────────
const STRINGS = {
  ko: {
    title: 'GFX 보관함',
    tabPending: '올리기 전 ({n})',
    tabUploaded: '올린 것 ({n})',
    selectAll: '모두 선택',
    selected: '{n}개 선택',
    delete: '선택 삭제',
    deleteConfirm: '선택한 {n}개를 보관함에서 지울까요? (이미 올린 레퍼런스는 그대로 남아요)',
    emptyPending: '아직 담은 사진이 없어요.\n핀터레스트에서 사진 위에 마우스를 올리고 「GFX에 담기」를 누르거나,\n아무 사이트에서나 사진을 오른쪽 클릭 → 「GFX 보관함에 담기」를 고르세요.',
    emptyUploaded: '아직 올린 사진이 없어요.',
    titlePh: '제목 (비우면 자동)',
    notFetched: '사진을 아직 못 받았어요 — 올릴 때 다시 받아요.',
    uploadedAs: '올림: {ref}',
    open: '열기',
    uploadTitle: '선택한 사진 올리기',
    category: '분류',
    mapName: '맵 이름 (필수)',
    creators: '제작자',
    creatorsHint: '쉼표로 여러 명. 비우면 올리는 사람 이름이 들어가요.',
    tags: '태그',
    tagFilterPh: '태그 찾기',
    noTags: '이 분류에 쓸 태그가 아직 없어요.',
    uploadN: '{n}개 올리기',
    uploadPick: '사진을 골라 주세요',
    uploading: '올리는 중… {i}/{n}',
    uploadHint: '출처(핀 주소)는 자동으로 함께 저장돼요. 1분에 10장까지 올릴 수 있어서 많으면 잠깐씩 기다려요.',
    linkFirst: '올리려면 먼저 디스코드 연동을 해 주세요.',
    notMember: 'GFX References 디스코드 서버 멤버만 올릴 수 있어요.',
    link: '🔗 디스코드 연동',
    logout: '연동 해제',
    server: '⚙ 서버',
    linkTitle: '디스코드 연동',
    linkHow: '디스코드에서 아래 명령어를 입력하세요.',
    linkWait: '입력하면 자동으로 연동돼요. (10분 안에)',
    copy: '복사',
    copied: '복사했어요',
    cancel: '취소',
    save: '저장',
    serverTitle: '서버 주소',
    serverHint: '보통은 바꿀 필요가 없어요. 바꾸면 연동이 풀려요.',
    connectFail: '서버에 연결하지 못했어요: {msg}',
    retry: '다시 시도',
    ok: '#{id} 올렸어요',
    dup: '비슷한 레퍼런스가 이미 있어요:',
    dupForce: '그래도 올리기',
    fail: '실패: {msg}',
    noImage: '사진을 받지 못했어요 (사이트가 막았거나 지워졌어요)',
    wait: '잠깐 기다렸다가 계속해요…',
    stopped: '멈췄어요.',
    permDenied: '다른 사이트 사진을 받으려면 권한을 허용해 주세요.',
  },
  en: {
    title: 'GFX box',
    tabPending: 'To upload ({n})',
    tabUploaded: 'Uploaded ({n})',
    selectAll: 'Select all',
    selected: '{n} selected',
    delete: 'Delete selected',
    deleteConfirm: 'Remove {n} item(s) from the box? (Uploaded references stay on the site)',
    emptyPending: 'Nothing saved yet.\nOn Pinterest, hover a picture and press “Save to GFX”,\nor right-click a picture on any site → “Save to GFX box”.',
    emptyUploaded: 'Nothing uploaded yet.',
    titlePh: 'Title (optional)',
    notFetched: 'Picture not downloaded yet — it will be fetched on upload.',
    uploadedAs: 'Uploaded: {ref}',
    open: 'Open',
    uploadTitle: 'Upload selected',
    category: 'Category',
    mapName: 'Map name (required)',
    creators: 'Creators',
    creatorsHint: 'Comma-separated. Empty = your name.',
    tags: 'Tags',
    tagFilterPh: 'Find a tag',
    noTags: 'No tags for this category yet.',
    uploadN: 'Upload {n}',
    uploadPick: 'Pick pictures first',
    uploading: 'Uploading… {i}/{n}',
    uploadHint: 'The source (pin link) is saved too. Up to 10 uploads per minute, so big batches pause now and then.',
    linkFirst: 'Link your Discord account to upload.',
    notMember: 'Only members of the GFX References Discord server can upload.',
    link: '🔗 Link Discord',
    logout: 'Unlink',
    server: '⚙ Server',
    linkTitle: 'Link Discord',
    linkHow: 'Type this command in Discord.',
    linkWait: 'It links automatically once you send it (within 10 minutes).',
    copy: 'Copy',
    copied: 'Copied',
    cancel: 'Cancel',
    save: 'Save',
    serverTitle: 'Server address',
    serverHint: 'Usually no need to change this. Changing it unlinks you.',
    connectFail: 'Could not reach the server: {msg}',
    retry: 'Retry',
    ok: 'Uploaded #{id}',
    dup: 'Similar reference already exists:',
    dupForce: 'Upload anyway',
    fail: 'Failed: {msg}',
    noImage: 'Could not download the picture (blocked or removed)',
    wait: 'Waiting a moment before continuing…',
    stopped: 'Stopped.',
    permDenied: 'Allow access to download pictures from other sites.',
  },
};
const lang = (navigator.language || '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
document.documentElement.lang = lang;
function t(key, vars) {
  let s = STRINGS[lang][key] ?? STRINGS.ko[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// ── 작은 도우미 ────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAST = 'gfxbox.last';

function loadLast() {
  try {
    return JSON.parse(localStorage.getItem(LAST) || '{}');
  } catch {
    return {};
  }
}

function saveLast() {
  try {
    localStorage.setItem(LAST, JSON.stringify({ category: $('category').value, tags: [...state.tags], creators: $('creators').value }));
  } catch {
    /* */
  }
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp' };

function fileNameOf(item) {
  const ext = EXT[item.mime] || 'png';
  let base = '';
  try {
    base = decodeURIComponent(new URL(item.imageUrl).pathname.split('/').pop() || '').replace(/\.[^.]+$/, '');
  } catch {
    /* data: 주소 등 */
  }
  base = base.replace(/[^\w\-가-힣]+/g, '_').slice(0, 60) || `gfx-box-${item.id}`;
  return `${base}.${ext}`;
}

// ── 상태 ────────────────────────────────────────────────
const state = {
  items: [],
  tab: 'pending',
  selected: new Set(),
  tags: new Set(loadLast().tags || []),
  uploading: false,
  stop: false,
  urls: new Map(), // 항목 번호 → 사진 임시 주소
};

// ── 계정 · 서버 ────────────────────────────────────────────
let linkHandle = null;

function renderAccount() {
  const box = $('account');
  box.replaceChildren();
  const user = client.user;
  if (user) {
    if (user.avatarUrl) box.append(h('img', { src: user.avatarUrl, alt: '' }));
    box.append(h('span', { class: 'name' }, user.displayName || user.username || ''));
    box.append(h('button', { type: 'button', class: 'btn link', onclick: () => client.logout().then(renderAll) }, t('logout')));
  } else {
    box.append(h('button', { type: 'button', class: 'btn primary', onclick: startLink }, t('link')));
  }
  box.append(h('button', { type: 'button', class: 'btn link', onclick: openServer }, t('server')));
}

function startLink() {
  const dlg = $('linkDialog');
  $('linkCode').textContent = '····-····';
  $('linkCommand').textContent = '';
  dlg.showModal();
  linkHandle = client.link({
    onCode: (c) => {
      $('linkCode').textContent = c.userCode;
      $('linkCommand').textContent = c.command;
    },
  });
  linkHandle.done
    .then(() => {
      dlg.close();
      renderAll();
    })
    .catch((e) => {
      if (e.code !== 'cancelled') showNotice(e.message);
      dlg.close();
    })
    .finally(() => {
      linkHandle = null;
    });
}

$('linkCancel').addEventListener('click', () => {
  if (linkHandle) linkHandle.cancel();
  $('linkDialog').close();
});

$('copyCommand').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('linkCommand').textContent);
    $('copyCommand').textContent = t('copied');
    setTimeout(() => ($('copyCommand').textContent = t('copy')), 1500);
  } catch {
    /* */
  }
});

function openServer() {
  $('serverInput').value = client.server;
  $('serverError').textContent = '';
  $('serverDialog').showModal();
}

$('serverCancel').addEventListener('click', () => $('serverDialog').close());

$('serverSave').addEventListener('click', async () => {
  const url = $('serverInput').value.trim().replace(/\/+$/, '');
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    $('serverError').textContent = 'http(s):// …';
    return;
  }
  // 기본 서버가 아니면 그 주소에 접속할 권한을 먼저 받음 (버튼을 누른 순간에만 물어볼 수 있음)
  const granted = await chrome.permissions.request({ origins: [origin + '/*'] }).catch(() => false);
  if (!granted) {
    $('serverError').textContent = t('permDenied');
    return;
  }
  try {
    await client.connect(url);
    $('serverDialog').close();
    hideNotice();
    renderAll();
  } catch (e) {
    $('serverError').textContent = e.message;
  }
});

function showNotice(msg, action) {
  const n = $('notice');
  n.replaceChildren(msg);
  if (action) n.append(' ', h('button', { type: 'button', class: 'btn', onclick: action.run }, action.label));
  n.classList.remove('hidden');
}

function hideNotice() {
  $('notice').classList.add('hidden');
}

async function connect() {
  try {
    await client.connect();
    hideNotice();
    if (client.isLinked()) await client.refreshUser().catch(() => null);
  } catch (e) {
    showNotice(t('connectFail', { msg: e.message }), { label: t('retry'), run: () => connect().then(renderAll) });
  }
}

// ── 사진 목록 ────────────────────────────────────────────
function visibleItems() {
  return state.items.filter((i) => (state.tab === 'pending' ? !i.uploadedRef : !!i.uploadedRef));
}

function renderTabs() {
  const pending = state.items.filter((i) => !i.uploadedRef).length;
  const uploaded = state.items.length - pending;
  for (const b of $('tabs').querySelectorAll('button')) {
    b.textContent = b.dataset.tab === 'pending' ? t('tabPending', { n: pending }) : t('tabUploaded', { n: uploaded });
    b.classList.toggle('on', b.dataset.tab === state.tab);
  }
}

function refUrl(id) {
  return `${client.server}/#/ref/${id}`;
}

function card(item) {
  const selected = state.selected.has(item.id);
  let src = item.imageUrl;
  if (item.blob) {
    src = state.urls.get(item.id);
    if (!src) {
      src = URL.createObjectURL(item.blob);
      state.urls.set(item.id, src);
    }
  }
  const toggle = () => {
    if (state.selected.has(item.id)) state.selected.delete(item.id);
    else state.selected.add(item.id);
    renderGrid();
  };
  const titleInput = h('input', {
    type: 'text',
    value: item.title || '',
    placeholder: t('titlePh'),
    maxLength: 100,
    onchange: (e) => {
      item.title = e.target.value.trim();
      updateItem(item.id, { title: item.title });
    },
  });
  return h(
    'div',
    { class: 'card' + (selected ? ' selected' : '') },
    h('img', { class: 'thumb', src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onclick: toggle }),
    h('input', { type: 'checkbox', class: 'pick', checked: selected, onchange: toggle }),
    h(
      'div',
      { class: 'body' },
      titleInput,
      h(
        'div',
        { class: 'meta' },
        item.pageUrl ? h('a', { href: item.pageUrl, target: '_blank', rel: 'noopener noreferrer' }, item.site || hostOf(item.pageUrl)) : h('span', {}, item.site || ''),
        h('span', {}, item.size ? (item.size < 1024 * 1024 ? `${Math.max(1, Math.round(item.size / 1024))}KB` : `${(item.size / 1024 / 1024).toFixed(1)}MB`) : ''),
      ),
      !item.blob && !item.uploadedRef ? h('div', { class: 'warn' }, t('notFetched')) : null,
      item.uploadedRef
        ? h('div', { class: 'done' }, t('uploadedAs', { ref: '' }), h('a', { href: refUrl(item.uploadedRef), target: '_blank', rel: 'noopener' }, `#${item.uploadedRef}`))
        : null,
    ),
  );
}

function renderGrid() {
  const items = visibleItems();
  // 화면에서 빠진 사진의 임시 주소는 정리
  const alive = new Set(items.map((i) => i.id));
  for (const [id, u] of state.urls) {
    if (!alive.has(id)) {
      URL.revokeObjectURL(u);
      state.urls.delete(id);
    }
  }
  // 다른 탭으로 넘어간 항목은 선택에서 뺌
  const ids = new Set(items.map((i) => i.id));
  for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);

  $('grid').replaceChildren(...items.map(card));
  const empty = $('empty');
  empty.textContent = state.tab === 'pending' ? t('emptyPending') : t('emptyUploaded');
  empty.classList.toggle('hidden', items.length > 0);

  const n = state.selected.size;
  $('selCount').textContent = n ? t('selected', { n }) : '';
  $('selectAll').checked = items.length > 0 && n === items.length;
  $('deleteSel').disabled = !n || state.uploading;
  renderTabs();
  renderUploadButton();
}

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b || state.uploading) return;
  state.tab = b.dataset.tab;
  state.selected.clear();
  renderGrid();
});

$('selectAll').addEventListener('change', (e) => {
  state.selected = e.target.checked ? new Set(visibleItems().map((i) => i.id)) : new Set();
  renderGrid();
});

$('deleteSel').addEventListener('click', async () => {
  const ids = [...state.selected];
  if (!ids.length || !confirm(t('deleteConfirm', { n: ids.length }))) return;
  await deleteItems(ids);
  state.selected.clear();
  await reload();
  chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => undefined);
});

async function reload() {
  state.items = await listItems();
  renderGrid();
}

// ── 올리기 설정 ────────────────────────────────────────────
function categoryInfo() {
  const meta = client.meta;
  return meta ? meta.categories.find((c) => c.key === $('category').value) : null;
}

function renderCategories() {
  const sel = $('category');
  const meta = client.meta;
  const prev = sel.value || loadLast().category;
  sel.replaceChildren();
  if (!meta) return;
  for (const c of meta.categories) sel.append(h('option', { value: c.key }, `${c.emoji} ${c.label}`));
  if (prev && meta.categories.some((c) => c.key === prev)) sel.value = prev;
  else if (meta.categories.some((c) => c.key === 'non_gm')) sel.value = 'non_gm'; // 핀터레스트 사진은 대개 비지메
}

function renderTags() {
  const box = $('tags');
  const meta = client.meta;
  const cat = categoryInfo();
  box.replaceChildren();
  if (!meta || !cat) return;
  const group = cat.tagGroup;
  const names = meta.tags.filter((tg) => tg.group === group).map((tg) => tg.name);
  // 다른 분류로 바꾸면 그 분류에 없는 태그는 뺌
  for (const n of [...state.tags]) if (!names.includes(n)) state.tags.delete(n);
  const q = $('tagFilter').value.trim().toLowerCase();
  const shown = names.filter((n) => !q || n.toLowerCase().includes(q) || state.tags.has(n));
  if (!names.length) {
    box.append(h('span', { class: 'dim small' }, t('noTags')));
    return;
  }
  for (const name of shown) {
    box.append(
      h(
        'button',
        {
          type: 'button',
          class: state.tags.has(name) ? 'on' : '',
          onclick: () => {
            if (state.tags.has(name)) state.tags.delete(name);
            else state.tags.add(name);
            saveLast();
            renderTags();
          },
        },
        name,
      ),
    );
  }
}

function renderMapField() {
  const cat = categoryInfo();
  $('mapField').classList.toggle('hidden', !(cat && cat.hasMapName));
}

function renderUploadButton() {
  const btn = $('uploadBtn');
  const n = state.selected.size;
  if (state.uploading) return;
  btn.disabled = !n || !client.meta || state.tab !== 'pending';
  btn.textContent = n ? t('uploadN', { n }) : t('uploadPick');
}

$('category').addEventListener('change', () => {
  saveLast();
  renderMapField();
  renderTags();
});
$('tagFilter').addEventListener('input', renderTags);
$('creators').addEventListener('change', saveLast);

function log(cls, ...parts) {
  const li = h('li', { class: cls }, ...parts);
  $('log').prepend(li);
  return li;
}

/** 아직 사진을 못 받은 항목이 있으면, 그 사이트 권한을 (버튼을 누른 지금) 한꺼번에 받음 */
async function askPermissions(items) {
  const origins = [...new Set(items.filter((i) => !i.blob && /^https?:/.test(i.imageUrl)).map((i) => new URL(i.imageUrl).origin + '/*'))];
  if (!origins.length) return true;
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins }).catch(() => false);
}

async function ensureBlob(item) {
  if (item.blob) return item;
  const file = await fetchImage(item.imageUrl);
  if (!file) return null;
  return updateItem(item.id, { blob: file.blob, mime: file.mime, size: file.size, imageUrl: file.url });
}

async function uploadOne(item, opts, allowDuplicate) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.upload({
        file: item.blob,
        filename: fileNameOf(item),
        category: opts.category,
        title: item.title || undefined,
        mapName: opts.mapName || undefined,
        creators: opts.creators || undefined,
        tags: opts.tags,
        sourceUrl: item.pageUrl || undefined,
        allowDuplicate,
      });
    } catch (e) {
      if (e.status === 429 && attempt < 4) {
        const li = log('dim', t('wait'));
        await sleep(15000);
        li.remove();
        continue;
      }
      throw e;
    }
  }
}

function itemLabel(item) {
  return item.title || item.site || `#${item.id}`;
}

async function handleUpload(item, opts, allowDuplicate) {
  const ready = await ensureBlob(item);
  if (!ready) {
    log('bad', `${itemLabel(item)} — ${t('noImage')}`);
    return 'skip';
  }
  try {
    const ref = await uploadOne(ready, opts, allowDuplicate);
    await updateItem(item.id, { uploadedRef: ref.id, uploadedAt: Date.now() });
    log('ok', `${itemLabel(item)} — `, h('a', { href: refUrl(ref.id), target: '_blank', rel: 'noopener' }, t('ok', { id: ref.id })));
    return 'ok';
  } catch (e) {
    if (e.code === 'duplicate') {
      const list = (e.matches || []).map((m, i) => [i ? ', ' : '', h('a', { href: refUrl(m.id), target: '_blank', rel: 'noopener' }, `#${m.id}`)]);
      const li = log('bad', `${itemLabel(item)} — ${t('dup')} `, ...list, ' ');
      li.append(
        h(
          'button',
          {
            type: 'button',
            class: 'btn link',
            onclick: async (ev) => {
              ev.target.disabled = true;
              const res = await handleUpload(item, opts, true);
              if (res === 'ok') li.remove();
              await reload();
            },
          },
          t('dupForce'),
        ),
      );
      return 'dup';
    }
    log('bad', `${itemLabel(item)} — ${t('fail', { msg: e.message })}`);
    // 연동이 풀렸거나 설정이 잘못된 경우에는 나머지도 안 되니 멈춤
    if (e.status === 401 || e.status === 403 || ['map_required', 'unknown_tag', 'link_required'].includes(e.code)) return 'stop';
    return 'fail';
  }
}

$('uploadBtn').addEventListener('click', async () => {
  if (state.uploading) {
    state.stop = true;
    return;
  }
  const items = state.items.filter((i) => state.selected.has(i.id) && !i.uploadedRef);
  if (!items.length) return;
  // 권한 요청은 클릭 직후에만 가능해서 가장 먼저
  if (!(await askPermissions(items))) {
    log('bad', t('permDenied'));
    return;
  }
  if (!client.isLinked()) {
    log('bad', t('linkFirst'));
    startLink();
    return;
  }
  if (client.user && client.user.isMember === false) {
    log('bad', t('notMember'));
    return;
  }
  const cat = categoryInfo();
  const opts = {
    category: $('category').value,
    mapName: cat && cat.hasMapName ? $('mapName').value.trim() : '',
    creators: $('creators').value.trim(),
    tags: [...state.tags],
  };
  if (cat && cat.requiresMapName && !opts.mapName) {
    log('bad', t('mapName'));
    $('mapName').focus();
    return;
  }
  saveLast();

  state.uploading = true;
  state.stop = false;
  $('deleteSel').disabled = true;
  const btn = $('uploadBtn');
  for (let i = 0; i < items.length; i++) {
    if (state.stop) {
      log('dim', t('stopped'));
      break;
    }
    btn.textContent = t('uploading', { i: i + 1, n: items.length }) + ' ■';
    const res = await handleUpload(items[i], opts, false);
    if (res === 'stop') break;
  }
  state.uploading = false;
  state.selected.clear();
  await reload();
  chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => undefined);
});

// ── 시작 ────────────────────────────────────────────────
function applyStaticText() {
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  $('tagFilter').placeholder = t('tagFilterPh');
  document.title = t('title');
  $('creators').value = loadLast().creators || '';
}

function renderAll() {
  renderAccount();
  renderCategories();
  renderMapField();
  renderTags();
  renderGrid();
}

client.on('auth', renderAccount);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'box-changed' && !state.uploading) reload();
});

applyStaticText();
await reload();
await connect();
renderAll();
