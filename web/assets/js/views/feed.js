import { api } from '../api.js';
import { emptyState, ResultsGrid } from '../components.js';
import { clear, debounce, fmtRelative, h } from '../dom.js';
import { t } from '../i18n.js';

// 썸네일이 실제 영상 목록에 올라간 것처럼 보여주는 화면.
// 등록된 지메 썸네일만, 제목은 맵 이름, 채널은 제작자.
const CATEGORY = 'gm_thumbnail';
const SORTS = ['random', 'popular', 'newest'];

function fromParams(p) {
  const sort = p.get('sort');
  return {
    sort: SORTS.includes(sort) ? sort : 'random',
    q: p.get('q') ?? '',
    theme: p.get('theme') === 'light' ? 'light' : 'dark',
  };
}

export function mountFeed(root, params) {
  const state = fromParams(params);
  let seed = newSeed();
  let grid = null;

  const input = h('input', {
    type: 'search',
    placeholder: t('feed.search'),
    value: state.q,
    autocomplete: 'off',
    'aria-label': t('explore.searchLabel'),
  });
  input.addEventListener(
    'input',
    debounce(() => set({ q: input.value.trim() }), 300),
  );
  const chips = h('div.yt-chips', { role: 'group', 'aria-label': t('explore.sortLabel') });
  const themeSeg = h('div.segmented');
  const results = h('div');
  const screen = h(
    'div.yt-screen',
    h(
      'div.yt-top',
      h(
        'form.yt-search',
        {
          role: 'search',
          onsubmit: (e) => {
            e.preventDefault();
            set({ q: input.value.trim() });
          },
        },
        input,
        h('button', { type: 'submit', 'aria-label': t('explore.searchLabel'), html: searchIcon() }),
      ),
      chips,
    ),
    results,
  );

  root.append(h('div.page-head', h('div', h('h1', 'Feed'), h('p', t('feed.lead'))), themeSeg), screen);

  function renderControls() {
    clear(chips);
    for (const key of SORTS) {
      chips.append(h('button', { type: 'button', class: state.sort === key ? 'on' : '', onclick: () => set({ sort: key }) }, t(`feed.sort.${key}`)));
    }
    if (state.sort === 'random') {
      chips.append(
        h(
          'button.shuffle',
          {
            type: 'button',
            title: t('feed.shuffle'),
            onclick: () => {
              seed = newSeed();
              reload();
            },
          },
          h('span', { html: shuffleIcon(), 'aria-hidden': 'true' }),
          t('feed.shuffle'),
        ),
      );
    }
    clear(themeSeg);
    for (const key of ['dark', 'light']) {
      themeSeg.append(h('button', { class: state.theme === key ? 'on' : '', onclick: () => set({ theme: key }) }, key === 'dark' ? 'Dark' : 'Light'));
    }
    screen.classList.toggle('light', state.theme === 'light');
    if (input.value.trim() !== state.q) input.value = state.q;
  }

  function reload() {
    grid?.destroy();
    clear(results);
    const s = { ...state };
    const sortParams = s.sort === 'random' ? { sort: 'random', seed } : s.sort === 'popular' ? { sort: 'popular', period: 'all' } : {};
    grid = new ResultsGrid({
      layout: 'grid',
      gridClass: 'yt-grid',
      card: videoCard,
      load: (page) => api.get('/api/refs', { category: CATEGORY, q: s.q, ...sortParams, page, limit: 24 }),
      empty: () => emptyState(s.q ? t('explore.noMatch') : t('feed.empty')),
    });
    results.append(grid.el);
  }

  function set(patch) {
    const sortChanged = patch.sort && patch.sort !== state.sort;
    const onlyTheme = Object.keys(patch).every((k) => k === 'theme');
    Object.assign(state, patch);
    if (sortChanged && state.sort === 'random') seed = newSeed();
    const p = new URLSearchParams();
    if (state.sort !== 'random') p.set('sort', state.sort);
    if (state.q) p.set('q', state.q);
    if (state.theme !== 'dark') p.set('theme', state.theme);
    history.replaceState(null, '', `#/feed${p.size ? `?${p}` : ''}`);
    renderControls();
    if (!onlyTheme) reload();
  }

  renderControls();
  reload();

  return {
    update(params) {
      const next = fromParams(params);
      if (next.sort === state.sort && next.q === state.q && next.theme === state.theme) return;
      set(next);
    },
    destroy: () => grid?.destroy(),
  };
}

/** 영상 카드: 16:9 썸네일 + 채널 동그라미 + 제목 · 채널 · 반응 수 · 올린 때 */
function videoCard(ref) {
  const title = ref.mapName || ref.title;
  const channel = ref.creator.name;
  const color = ref.palette[0]?.hex ?? '#444';
  const img = h('img', { src: ref.preview.url, alt: title, loading: 'lazy', decoding: 'async' });
  const markLoaded = () => img.classList.add('loaded');
  img.addEventListener('load', markLoaded, { once: true });
  const card = h(
    'a.yt-card',
    { href: `#/ref/${ref.id}`, title },
    h('div.yt-thumb', { style: { background: color } }, img, h('span.yt-badge', `#${ref.id}`)),
    h(
      'div.yt-info',
      h('span.yt-avatar', { style: { background: color, color: textOn(color) }, 'aria-hidden': 'true' }, initial(channel)),
      h(
        'div.yt-text',
        h('div.yt-title', title),
        h('div.yt-channel', channel),
        h('div.yt-meta', `${t('feed.reactions', { n: ref.reactionTotal.toLocaleString() })} · ${fmtRelative(ref.createdAt)}`),
      ),
    ),
  );
  if (img.complete) markLoaded();
  return card;
}

function initial(name) {
  const ch = [...(name || '?').trim()][0] ?? '?';
  return ch.toUpperCase();
}

/** 배경색 위에서 잘 보이는 글자색 */
function textOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#0f0f0f' : '#fff';
}

function newSeed() {
  return Math.random().toString(36).slice(2, 10);
}

function searchIcon() {
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
}

function shuffleIcon() {
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/></svg>';
}
