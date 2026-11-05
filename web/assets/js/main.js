import { api } from './api.js';
import { discordIcon, handleApiError, openLogin } from './components.js';
import { avatarSrc, clear, h, spinner, splitText, toast } from './dom.js';
import { applyStatic, getLang, onLangChange, setLang, t } from './i18n.js';
import { store } from './store.js';
import { mountBoard, mountBoards } from './views/boards.js';
import { mountColors } from './views/colors.js';
import { openDetail } from './views/detail.js';
import { mountEdits } from './views/edits.js';
import { mountExplore } from './views/explore.js';
import { mountFeed } from './views/feed.js';
import { mountImport } from './views/import.js';
import { mountLeaderboard } from './views/leaderboard.js';
import { mountPopular } from './views/popular.js';
import { mountProfile } from './views/profile.js';
import { mountReports } from './views/reports.js';
import { mountResource, mountResources } from './views/resources.js';
import { mountShowcase, mountShowcaseItem } from './views/showcase.js';
import { mountTags } from './views/tags.js';
import { openUploadForm } from './views/upload.js';

const app = document.getElementById('app');
let current = { key: null, view: null };
let detail = null; // { id, overlay }
let baseHash = '#/';
let enteredDetailFromSite = false;

function parseHashString(hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

function parseHash() {
  return parseHashString(window.location.hash);
}

function navigate(hash) {
  if (window.location.hash === hash) route();
  else window.location.hash = hash;
}

function matchView(path) {
  let m;
  if (path === '/' || path === '') return { key: 'explore', mount: mountExplore, extra: { scope: 'gd' } };
  if (path === '/nongd') return { key: 'nongd', mount: mountExplore, extra: { scope: 'nongd' } };
  if (path === '/feed') return { key: 'feed', mount: mountFeed };
  if (path === '/popular') return { key: 'popular', mount: mountPopular };
  if (path === '/colors') return { key: 'colors', mount: mountColors };
  if (path === '/leaderboard') return { key: 'leaderboard', mount: mountLeaderboard };
  if (path === '/import') return { key: 'import', mount: mountImport };
  if (path === '/boards') return { key: 'boards', mount: mountBoards };
  if (path === '/edits') return { key: 'edits', mount: mountEdits };
  if (path === '/tags') return { key: 'tags', mount: mountTags };
  if (path === '/reports') return { key: 'reports', mount: mountReports };
  if (path === '/assets') return { key: 'assets', mount: mountResources, extra: { kind: 'asset' } };
  if (path === '/plugins') return { key: 'plugins', mount: mountResources, extra: { kind: 'plugin' } };
  if (path === '/texturepacks') return { key: 'texturepacks', mount: mountResources, extra: { kind: 'texturepack' } };
  if (path === '/showcase') return { key: 'showcase', mount: mountShowcase };
  if ((m = /^\/showcase\/(\d+)$/.exec(path))) return { key: `showcase:${m[1]}`, nav: 'showcase', mount: mountShowcaseItem, extra: { id: m[1] } };
  if ((m = /^\/res\/(\d+)$/.exec(path))) return { key: `res:${m[1]}`, nav: 'res', mount: mountResource, extra: { id: m[1] } };
  if ((m = /^\/board\/(\d+)$/.exec(path))) return { key: `board:${m[1]}`, nav: 'boards', mount: mountBoard, extra: { id: m[1] } };
  if ((m = /^\/user\/(\d+)$/.exec(path))) return { key: `user:${m[1]}`, nav: 'leaderboard', mount: mountProfile, extra: { id: m[1] } };
  return null;
}

function mountBase(path, params) {
  const v = matchView(path) ?? matchView('/');
  if (current.key === v.key && current.view?.update) {
    current.view.update(params);
  } else if (current.key !== v.key) {
    current.view?.destroy?.();
    clear(app);
    window.scrollTo(0, 0);
    document.title = 'GFX References';
    current = { key: v.key, view: v.mount(app, params, { navigate, ...(v.extra ?? {}) }) };
    // 화면이 바뀔 때 살짝 떠오르는 전환 효과
    app.classList.remove('page-enter');
    void app.offsetWidth;
    app.classList.add('page-enter');
  }
  for (const a of document.querySelectorAll('#nav a, #nav-more a')) a.classList.toggle('active', a.dataset.route === (v.nav ?? v.key));
  syncMoreActive();
}

function route() {
  const { path, params } = parseHash();

  if (path === '/login-error') {
    toast(params.get('msg') || t('login.failed'), 'error');
    history.replaceState(null, '', '#/');
    return route();
  }

  const m = /^\/ref\/(\d+)$/.exec(path);
  if (m) {
    const id = Number(m[1]);
    if (!current.key) mountBase('/', new URLSearchParams());
    if (detail?.id === id) return;
    if (detail) {
      const old = detail;
      detail = null;
      old.overlay.close();
    }
    const overlay = openDetail(id, {
      navigate,
      onClose: () => {
        if (detail?.overlay !== overlay) return;
        detail = null;
        document.title = 'GFX References';
        if (parseHash().path.startsWith('/ref/')) {
          if (enteredDetailFromSite) history.back();
          else navigate(baseHash);
        }
      },
    });
    detail = { id, overlay };
    return;
  }

  if (detail) {
    const old = detail;
    detail = null;
    old.overlay.close();
  }
  baseHash = window.location.hash || '#/';
  enteredDetailFromSite = true;
  mountBase(path, params);
}

// ── 상단 바 ────────────────────────────────────────────

function renderAccount() {
  const root = document.getElementById('account');
  clear(root);
  const me = store.me;
  if (!me) {
    root.append(
      h('button.btn.discord.sm', { onclick: () => openLogin(), 'aria-label': t('account.login') }, discordIcon(), h('span.label', t('account.login'))),
    );
    return;
  }
  const menu = h(
    'div.menu',
    h('div.menu-head', t('account.hello', { name: me.displayName || me.username })),
    h('a', { href: `#/user/${me.id}`, onclick: () => menu.classList.remove('open') }, t('account.profile')),
    h('a', { href: '#/boards', onclick: () => menu.classList.remove('open') }, t('account.boards')),
    h(
      'a',
      { href: '#/edits', onclick: () => menu.classList.remove('open') },
      t('account.edits'),
      me.pendingEdits ? h('span.badge', String(me.pendingEdits)) : null,
    ),
    me.isMember || me.isAdmin ? h('a', { href: '#/import', onclick: () => menu.classList.remove('open') }, t('account.import')) : null,
    me.isAdmin ? h('a', { href: '#/tags', onclick: () => menu.classList.remove('open') }, t('account.tags')) : null,
    me.isAdmin
      ? h(
          'a',
          { href: '#/reports', onclick: () => menu.classList.remove('open') },
          t('account.reports'),
          me.openReports ? h('span.badge', String(me.openReports)) : null,
        )
      : null,
    me.isAdmin && me.pendingShowcase
      ? h(
          'a',
          { href: '#/showcase?tab=requests', onclick: () => menu.classList.remove('open') },
          t('account.showcaseRequests'),
          h('span.badge', String(me.pendingShowcase)),
        )
      : null,
    h(
      'button',
      {
        onclick: async () => {
          await api.post('/api/auth/logout').catch(() => undefined);
          store.setMe(null);
          toast(t('account.loggedOut'));
        },
      },
      t('account.logout'),
    ),
  );
  const btn = h(
    'button.account-btn',
    {
      'aria-label': t('account.menu'),
      onclick: (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
      },
    },
    h('img.avatar', { src: avatarSrc(me.avatarUrl), alt: me.username }),
    me.pendingEdits || me.openReports || me.pendingShowcase
      ? h('span.badge.dot', { title: t('account.edits') }, String((me.pendingEdits ?? 0) + (me.openReports ?? 0) + (me.pendingShowcase ?? 0)))
      : null,
  );
  root.append(h('div.account', btn, menu));
}

document.addEventListener('click', () => {
  for (const m of document.querySelectorAll('.menu.open')) m.classList.remove('open');
});

// ── 상단 메뉴 맞추기 ──────────────────────────────────
// 메뉴가 상단 바에 다 안 들어가면 먼저 촘촘하게(점 · 로고 글자 빼기) 하고,
// 그래도 넘치면 뒤쪽 메뉴부터 "More" 안으로 옮김. 화면 크기가 바뀔 때마다 다시 맞춤.
// (휴대폰 화면에서는 메뉴가 아랫줄에서 옆으로 밀리므로 그대로 둠)

function syncMoreActive() {
  const more = document.getElementById('nav-more');
  more?.querySelector('button')?.classList.toggle('active', !!more.querySelector('a.active'));
}

function setupNavFit() {
  const topbar = document.getElementById('topbar');
  const nav = document.getElementById('nav');
  const more = document.getElementById('nav-more');
  const links = [...nav.querySelectorAll('a[data-route]')];
  const list = h('div.menu.nav-more-list');
  const btn = h(
    'button',
    {
      type: 'button',
      'aria-haspopup': 'true',
      onclick: (e) => {
        e.stopPropagation();
        for (const m of document.querySelectorAll('.menu.open')) if (m !== list) m.classList.remove('open');
        list.classList.toggle('open');
      },
    },
    'More',
    h('span.chev', { 'aria-hidden': 'true' }, '▾'),
  );
  more.append(btn, list);

  const overflowing = () => nav.scrollWidth > nav.clientWidth + 1;
  let frame = 0;
  const fit = () => {
    frame = 0;
    topbar.classList.remove('nav-tight');
    for (const a of links) a.hidden = false;
    more.hidden = true;
    clear(list);
    if (window.innerWidth <= 720 || !overflowing()) return;
    topbar.classList.add('nav-tight');
    if (!overflowing()) return;
    more.hidden = false;
    const moved = [];
    for (let i = links.length - 1; i > 0 && overflowing(); i--) {
      links[i].hidden = true;
      moved.unshift(links[i]);
    }
    for (const a of moved) {
      list.append(
        h('a', { href: a.getAttribute('href'), dataset: { route: a.dataset.route }, class: a.classList.contains('active') ? 'active' : '', onclick: () => list.classList.remove('open') }, a.textContent),
      );
    }
    syncMoreActive();
  };
  const later = () => {
    if (!frame) frame = requestAnimationFrame(fit);
  };
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(later);
    ro.observe(topbar.querySelector('.topbar-inner'));
    ro.observe(topbar.querySelector('.topbar-right'));
  }
  window.addEventListener('resize', later);
  onLangChange(later);
  document.fonts?.ready.then(later);
  fit();
}

function renderStatus() {
  const meta = store.meta;
  const el = document.getElementById('bot-status');
  const online = !!meta?.bot?.online;
  el.className = `bot-status ${online ? 'online' : 'offline'}`;
  el.querySelector('span').textContent = online ? t('bot.online') : t('bot.offline');
  el.title = online ? `${t('bot.onlineTitle')}${meta.guild?.guildName ? ` (${meta.guild.guildName})` : ''}` : t('bot.offlineTitle');

  const banner = document.getElementById('banner');
  clear(banner);
  if (meta && !meta.archive?.available) {
    banner.className = 'banner';
    banner.append(h('div', t('banner.offline')));
  }
}

async function openRandom() {
  try {
    const { item } = await api.get('/api/refs/random');
    navigate(`#/ref/${item.id}`);
  } catch (err) {
    handleApiError(err);
  }
}
for (const btn of document.querySelectorAll('[data-random]')) btn.addEventListener('click', openRandom);

// ── 언어 ───────────────────────────────────────────────

function renderLangSwitch() {
  for (const b of document.querySelectorAll('#lang-switch [data-lang]')) {
    const on = b.dataset.lang === getLang();
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

document.getElementById('upload-btn').addEventListener('click', () => openUploadForm({ navigate }));

// ── 그레인 켜기 / 끄기 (이 브라우저에만 기억) ───────────────

const grainBtn = document.getElementById('grain-toggle');
function renderGrain() {
  grainBtn.setAttribute('aria-pressed', String(!document.documentElement.classList.contains('no-grain')));
}
grainBtn.addEventListener('click', () => {
  const off = document.documentElement.classList.toggle('no-grain');
  try {
    if (off) localStorage.setItem('gfx.grain', 'off');
    else localStorage.removeItem('gfx.grain');
  } catch {
    /* 저장 못 해도 지금 화면에는 적용 */
  }
  renderGrain();
});
renderGrain();

document.getElementById('lang-switch').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lang]');
  if (b) setLang(b.dataset.lang);
});

/** 언어를 바꾸면 지금 화면을 새 언어로 다시 그림 (주소는 그대로) */
function rerender() {
  applyStatic();
  renderLangSwitch();
  if (!store.meta) return;
  renderAccount();
  renderStatus();
  if (!current.key) return;
  const openId = detail?.id ?? null;
  if (detail) {
    const old = detail;
    detail = null;
    old.overlay.close();
  }
  const base = openId !== null ? parseHashString(baseHash) : parseHash();
  current.view?.destroy?.();
  current = { key: null, view: null };
  mountBase(base.path, base.params);
  if (openId !== null) route();
}
onLangChange(rerender);

// ── 모바일: 아래로 스크롤하면 상단 바를 숨기고, 위로 올리면 다시 보여줌 ──

let lastScrollY = window.scrollY;
window.addEventListener(
  'scroll',
  () => {
    const y = window.scrollY;
    if (Math.abs(y - lastScrollY) < 8) return;
    document.body.classList.toggle('nav-hidden', y > lastScrollY && y > 160);
    lastScrollY = y;
  },
  { passive: true },
);

// ── 바닥 워드마크: 화면에 들어오면 글자가 차례로 올라옴 ──────────

function setupFooter() {
  const footer = document.getElementById('footer');
  for (const el of footer.querySelectorAll('[data-split]')) {
    const lines = el.innerHTML.split(/<br\s*\/?>/i).map((s) => s.trim());
    clear(el);
    let i = 0;
    lines.forEach((line, n) => {
      if (n) el.append(h('br'));
      el.append(...splitText(line, i));
      i += line.length;
    });
  }
  if (!('IntersectionObserver' in window)) {
    footer.classList.add('in');
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      // 볼 때마다 다시 재생되도록 화면 밖으로 나가면 원래대로
      for (const e of entries) footer.classList.toggle('in', e.isIntersecting);
    },
    { threshold: 0.25 },
  );
  io.observe(footer.querySelector('.footer-bottom'));
}

// ── 시작 ───────────────────────────────────────────────

async function start() {
  applyStatic();
  renderLangSwitch();
  setupNavFit();
  setupFooter();
  app.append(spinner());
  try {
    await store.init();
  } catch (err) {
    clear(app).append(h('div.empty', h('div', t('start.failed')), h('div.hint', err.message)));
    return;
  }
  clear(app);
  store.on(() => {
    renderAccount();
    renderStatus();
  });
  renderAccount();
  renderStatus();
  window.addEventListener('hashchange', route);
  route();
  // 봇 상태와 태그 개수는 가끔 새로고침
  setInterval(() => store.refreshMeta().catch(() => undefined), 60_000);
}

start();
