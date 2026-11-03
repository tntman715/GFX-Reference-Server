import { api } from './api.js';
import { discordIcon, handleApiError, openLogin } from './components.js';
import { avatarSrc, clear, h, spinner, toast } from './dom.js';
import { store } from './store.js';
import { mountColors } from './views/colors.js';
import { openDetail } from './views/detail.js';
import { mountExplore } from './views/explore.js';
import { mountLeaderboard } from './views/leaderboard.js';
import { mountPopular } from './views/popular.js';
import { mountProfile } from './views/profile.js';

const app = document.getElementById('app');
let current = { key: null, view: null };
let detail = null; // { id, overlay }
let baseHash = '#/';
let enteredDetailFromSite = false;

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

function navigate(hash) {
  if (window.location.hash === hash) route();
  else window.location.hash = hash;
}

function matchView(path) {
  let m;
  if (path === '/' || path === '') return { key: 'explore', mount: mountExplore };
  if (path === '/popular') return { key: 'popular', mount: mountPopular };
  if (path === '/colors') return { key: 'colors', mount: mountColors };
  if (path === '/leaderboard') return { key: 'leaderboard', mount: mountLeaderboard };
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
  }
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.route === (v.nav ?? v.key));
}

function route() {
  const { path, params } = parseHash();

  if (path === '/login-error') {
    toast(params.get('msg') || '로그인하지 못했어요.', 'error');
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
    root.append(h('button.btn.discord.sm', { onclick: () => openLogin(), 'aria-label': '로그인' }, discordIcon(), h('span.label', '로그인')));
    return;
  }
  const menu = h(
    'div.menu',
    h('div.menu-head', `${me.displayName || me.username} 님`),
    h('a', { href: `#/user/${me.id}`, onclick: () => menu.classList.remove('open') }, '👤 내 프로필'),
    h(
      'button',
      {
        onclick: async () => {
          await api.post('/api/auth/logout').catch(() => undefined);
          store.setMe(null);
          toast('로그아웃했어요');
        },
      },
      '🚪 로그아웃',
    ),
  );
  const btn = h(
    'button',
    {
      style: { background: 'none', border: 0, padding: 0, cursor: 'pointer' },
      'aria-label': '계정 메뉴',
      onclick: (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
      },
    },
    h('img.avatar', { src: avatarSrc(me.avatarUrl), alt: me.username }),
  );
  root.append(h('div.account', btn, menu));
}

document.addEventListener('click', () => document.querySelector('.menu.open')?.classList.remove('open'));

function renderStatus() {
  const meta = store.meta;
  const el = document.getElementById('bot-status');
  const online = !!meta?.bot?.online;
  el.className = `bot-status ${online ? 'online' : 'offline'}`;
  el.querySelector('span').textContent = online ? '봇 온라인' : '봇 오프라인';
  el.title = online ? `디스코드 봇이 연결되어 있어요${meta.guild?.guildName ? ` (${meta.guild.guildName})` : ''}` : '디스코드 봇이 오프라인이에요';

  const banner = document.getElementById('banner');
  clear(banner);
  if (meta && !meta.archive?.available) {
    banner.className = 'banner';
    banner.append(h('div', '⚠️ 디스코드 봇이 오프라인이라 원본 다운로드가 잠시 안 돼요. 검색과 미리보기는 계속 사용할 수 있어요.'));
  }
}

document.getElementById('random-btn').addEventListener('click', async () => {
  try {
    const { item } = await api.get('/api/refs/random');
    navigate(`#/ref/${item.id}`);
  } catch (err) {
    handleApiError(err);
  }
});

// ── 시작 ───────────────────────────────────────────────

async function start() {
  app.append(spinner());
  try {
    await store.init();
  } catch (err) {
    clear(app).append(h('div.empty', h('div.big', '🔌'), '서버에 연결할 수 없어요. 잠시 후 새로고침해 주세요.', h('div.hint', err.message)));
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
