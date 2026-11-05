import { api } from '../api.js';
import { emptyState, ResultsGrid } from '../components.js';
import { clear, debounce, h, splitText } from '../dom.js';
import { categoryLabel, colorLabel, t } from '../i18n.js';
import { store } from '../store.js';

const SORTS = ['newest', 'popular', 'oldest', 'random'];

function fromParams(p) {
  return {
    q: p.get('q') ?? '',
    category: p.get('category') ?? '',
    tags: (p.get('tags') ?? '').split(',').filter(Boolean),
    color: p.get('color') ?? '',
    hex: p.get('hex') ?? '',
    sort: p.get('sort') ?? '',
    creator: p.get('creator') ?? '',
    uploader: p.get('uploader') ?? '',
    uploaderName: p.get('uploaderName') ?? '',
  };
}

function toQuery(s) {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.category) p.set('category', s.category);
  if (s.tags.length) p.set('tags', s.tags.join(','));
  if (s.color) p.set('color', s.color);
  if (s.hex) p.set('hex', s.hex);
  if (s.sort) p.set('sort', s.sort);
  if (s.creator) p.set('creator', s.creator);
  if (s.uploader) p.set('uploader', s.uploader);
  if (s.uploaderName) p.set('uploaderName', s.uploaderName);
  return p.toString();
}

/**
 * 둘러보기. scope 가 'gd' 면 지메(썸네일 · 기타 작업물)만, 'nongd' 면 비지메만 보여 줌.
 * 지메와 비지메는 태그도 따로 씀.
 */
export function mountExplore(root, params, opts = {}) {
  const meta = store.meta;
  const scope = opts.scope === 'nongd' ? 'nongd' : 'gd';
  const basePath = scope === 'nongd' ? '#/nongd' : '#/';
  const scopeCats = (meta?.categories ?? []).filter((c) => (c.tagGroup ?? 'gd') === scope);
  const scopeTags = store.tagsInGroup(scope);
  const state = fromParams(params);
  if (state.category && !scopeCats.some((c) => c.key === state.category)) state.category = '';
  let grid = null;

  // ── 검색창 ──
  const input = h('input', {
    type: 'search',
    placeholder: t('explore.search'),
    value: state.q,
    autocomplete: 'off',
    'aria-label': t('explore.searchLabel'),
  });
  input.addEventListener(
    'input',
    debounce(() => set({ q: input.value.trim() }), 280),
  );
  const onSlash = (e) => {
    if (e.key === '/' && document.activeElement !== input && !/input|textarea|select/i.test(document.activeElement?.tagName ?? '')) {
      e.preventDefault();
      input.focus();
    }
  };
  document.addEventListener('keydown', onSlash);

  // ── 필터 ──
  const catSeg = h('div.segmented');
  const colorItems = h('div.items');
  const tagItems = h('div.items');
  const sortSelect = h(
    'select.select',
    { 'aria-label': t('explore.sortLabel'), onchange: () => set({ sort: sortSelect.value === 'newest' ? '' : sortSelect.value }) },
    SORTS.map((k) => h('option', { value: k }, t(`sort.${k}`))),
  );
  const picker = h('input', {
    type: 'color',
    value: state.hex || '#ff7a1a',
    title: t('explore.customColorTitle'),
    onchange: () => set({ hex: picker.value, color: '' }),
  });

  const countEl = h('span.count', '');
  const activeEl = h('div.active-filters');
  const resultsEl = h('div');

  const catCounts = meta?.stats?.categories ?? {};
  const total = scopeCats.reduce((n, c) => n + (catCounts[c.key] ?? 0), 0);

  // ── 표지: 인기 레퍼런스 한 장을 배경으로 깔고 큰 워드마크 ──
  const heroBg = h('div.hero-bg', { 'aria-hidden': 'true' });
  const heroCover = h('div');
  const banner = h(
    'div.hero-banner',
    heroBg,
    h(
      'div.hero-top',
      h(
        'div.hero-pills',
        scopeCats.slice(0, 3).map((c) =>
          h(
            'button',
            { type: 'button', title: t('explore.onlyCategory', { label: categoryLabel(c) }), onclick: () => set({ category: c.key }) },
            categoryLabel(c, true),
          ),
        ),
      ),
      h('span.hero-vol', `Vol. ${String(total).padStart(3, '0')}`),
    ),
    h(
      'div',
      scope === 'nongd'
        ? h('h1.split', { 'aria-label': 'Non-GD References' }, splitText('Non-GD'))
        : h('h1.split', { 'aria-label': 'GFX References' }, splitText('GFX References')),
      h('div.hero-foot', h('p', t(scope === 'nongd' ? 'explore.leadNonGd' : 'explore.lead', { n: total.toLocaleString() })), heroCover),
    ),
  );
  loadCover();

  root.append(
    h(
      'section.hero',
      banner,
      h('div.searchbox', h('span.icon', { html: searchIcon() }), input, h('kbd', '/')),
      h(
        'div.filters',
        scopeCats.length > 1 ? h('div.filter-row', h('span.label', 'Category'), h('div.items', catSeg)) : null,
        h('div.filter-row', h('span.label', 'Color'), colorItems),
        h('div.filter-row', h('span.label', 'Tags'), tagItems),
      ),
    ),
    h('div.results-head', h('div.results-info', countEl, activeEl), sortSelect),
    resultsEl,
  );

  function renderControls() {
    clear(catSeg);
    const counts = meta?.stats?.categories ?? {};
    catSeg.append(h('button', { class: state.category ? '' : 'on', onclick: () => set({ category: '' }) }, t('all')));
    for (const c of scopeCats) {
      catSeg.append(
        h(
          'button',
          { class: state.category === c.key ? 'on' : '', onclick: () => set({ category: state.category === c.key ? '' : c.key }) },
          `${categoryLabel(c)} `,
          h('span.faint', String(counts[c.key] ?? 0)),
        ),
      );
    }

    clear(colorItems);
    for (const c of meta?.colors ?? []) {
      colorItems.append(
        h('button.swatch', {
          class: state.color === c.key ? 'on' : '',
          style: { background: c.hex },
          title: colorLabel(c),
          'aria-label': colorLabel(c),
          onclick: () => set({ color: state.color === c.key ? '' : c.key, hex: '' }),
        }),
      );
    }
    picker.value = state.hex || picker.value;
    colorItems.append(h('span.color-picker', picker, h('span.hint', state.hex ? state.hex : t('explore.customColor'))));

    clear(tagItems);
    for (const tag of scopeTags) {
      const on = state.tags.includes(tag.name);
      tagItems.append(
        h(
          'button.chip',
          {
            class: on ? 'on' : '',
            title: tag.description ?? '',
            onclick: () => set({ tags: on ? state.tags.filter((x) => x !== tag.name) : [...state.tags, tag.name] }),
          },
          `#${tag.name}`,
          h('span.count', String(tag.count)),
        ),
      );
    }

    sortSelect.value = state.sort || 'newest';
    sortSelect.disabled = !!state.hex;
    sortSelect.title = state.hex ? t('explore.hexSort') : '';
    if (input.value.trim() !== state.q) input.value = state.q;

    clear(activeEl);
    const chip = (label, clearPatch, dot) =>
      h(
        'button.chip.on',
        { onclick: () => set(clearPatch), title: t('explore.removeFilter') },
        dot ? h('span.dot', { style: { background: dot } }) : null,
        label,
        h('span.x', { 'aria-hidden': 'true' }, '×'),
      );
    if (state.q) activeEl.append(chip(`"${state.q}"`, { q: '' }));
    if (state.category) activeEl.append(chip(categoryLabel(store.category(state.category)) || state.category, { category: '' }));
    if (state.color) {
      const c = store.color(state.color);
      activeEl.append(chip(colorLabel(c) || state.color, { color: '' }, c?.hex));
    }
    if (state.hex) activeEl.append(chip(state.hex, { hex: '' }, state.hex));
    for (const tag of state.tags) activeEl.append(chip(`#${tag}`, { tags: state.tags.filter((x) => x !== tag) }));
    if (state.creator) activeEl.append(chip(t('explore.creator', { name: state.creator }), { creator: '' }));
    if (state.uploader) activeEl.append(chip(t('explore.uploader', { name: state.uploaderName || state.uploader }), { uploader: '', uploaderName: '' }));
    const any = state.q || state.category || state.color || state.hex || state.tags.length || state.creator || state.uploader;
    if (any) {
      activeEl.append(
        h(
          'button.btn.ghost.sm',
          { onclick: () => set({ q: '', category: '', color: '', hex: '', tags: [], creator: '', uploader: '', uploaderName: '' }) },
          t('explore.clearAll'),
        ),
      );
    }
  }

  async function loadCover() {
    try {
      const { items } = await api.get('/api/refs', { sort: 'popular', period: 'all', scope, page: 1, limit: 6 });
      const pick = items[Math.floor(Math.random() * items.length)];
      if (!pick) return;
      const img = new Image();
      img.onload = () => {
        heroBg.style.backgroundImage = `url("${pick.preview.url}")`;
        heroBg.classList.add('loaded');
      };
      img.src = pick.preview.url;
      heroCover.replaceWith(
        h('a.hero-cover', { href: `#/ref/${pick.id}` }, h('span.k', 'Cover'), `#${pick.id} ${pick.title} · ${pick.creator.name}`),
      );
    } catch {
      /* 표지 사진은 없어도 괜찮아요 */
    }
  }

  function reload() {
    grid?.destroy();
    clear(resultsEl);
    countEl.textContent = t('explore.searching');
    const s = { ...state };
    const seed = Math.random().toString(36).slice(2, 10);
    grid = new ResultsGrid({
      load: (page) =>
        api.get('/api/refs', {
          q: s.q,
          category: s.category,
          scope,
          tags: s.tags,
          color: s.color,
          hex: s.hex,
          sort: s.hex ? undefined : s.sort || undefined,
          period: s.sort === 'popular' ? 'all' : undefined,
          seed: s.sort === 'random' ? seed : undefined,
          creator: s.creator,
          uploader: s.uploader,
          page,
          limit: 30,
        }),
      onTotal: (n) => {
        countEl.textContent = t(n === 1 ? 'explore.countOne' : 'explore.count', { n: n.toLocaleString() });
      },
      empty: () => emptyState(total ? t('explore.noMatch') : t('explore.noRefs')),
    });
    resultsEl.append(grid.el);
  }

  function set(patch) {
    Object.assign(state, patch);
    const q = toQuery(state);
    history.replaceState(null, '', `${basePath}${q ? `?${q}` : ''}`);
    renderControls();
    reload();
  }

  renderControls();
  reload();

  return {
    update(params) {
      const next = fromParams(params);
      if (toQuery(next) === toQuery(state)) return;
      Object.assign(state, next);
      renderControls();
      reload();
    },
    refresh() {
      renderControls();
    },
    destroy() {
      grid?.destroy();
      document.removeEventListener('keydown', onSlash);
    },
  };
}

function searchIcon() {
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
}
