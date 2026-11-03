import { api } from '../api.js';
import { emptyState, ResultsGrid } from '../components.js';
import { clear, debounce, h } from '../dom.js';
import { store } from '../store.js';

const SORT_LABELS = { newest: '최신순', popular: '인기순', oldest: '오래된순', random: '무작위' };

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

export function mountExplore(root, params) {
  const meta = store.meta;
  const state = fromParams(params);
  let grid = null;

  // ── 검색창 ──
  const input = h('input', {
    type: 'search',
    placeholder: '제목, 맵 이름, 제작자, 태그, #번호로 검색',
    value: state.q,
    autocomplete: 'off',
    'aria-label': '검색',
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
    { 'aria-label': '정렬', onchange: () => set({ sort: sortSelect.value === 'newest' ? '' : sortSelect.value }) },
    Object.entries(SORT_LABELS).map(([k, v]) => h('option', { value: k }, v)),
  );
  const picker = h('input', {
    type: 'color',
    value: state.hex || '#8b6cff',
    title: '원하는 색으로 찾기',
    onchange: () => set({ hex: picker.value, color: '' }),
  });

  const countEl = h('span.count', '');
  const activeEl = h('div.active-filters');
  const resultsEl = h('div');

  const total = meta?.stats?.total ?? 0;
  root.append(
    h(
      'section.hero',
      h(
        'div',
        h('h1', 'GFX ', h('span.grad', '레퍼런스'), ' 아카이브'),
        h('p', `디스코드에 모인 ${total.toLocaleString()}개의 썸네일 · 작업물 레퍼런스를 찾아보세요.`),
      ),
      h('div.searchbox', h('span.icon', { html: searchIcon() }), input, h('kbd', '/')),
      h(
        'div.filters',
        h('div.filter-row', h('span.label', '분류'), h('div.items', catSeg)),
        h('div.filter-row', h('span.label', '색상'), colorItems),
        h('div.filter-row', h('span.label', '태그'), tagItems),
      ),
    ),
    h('div.results-head', h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } }, countEl, activeEl), sortSelect),
    resultsEl,
  );

  function renderControls() {
    clear(catSeg);
    const counts = meta?.stats?.categories ?? {};
    catSeg.append(h('button', { class: state.category ? '' : 'on', onclick: () => set({ category: '' }) }, '전체'));
    for (const c of meta?.categories ?? []) {
      catSeg.append(
        h(
          'button',
          { class: state.category === c.key ? 'on' : '', onclick: () => set({ category: state.category === c.key ? '' : c.key }) },
          `${c.emoji} ${c.label} `,
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
          title: c.label,
          'aria-label': c.label,
          onclick: () => set({ color: state.color === c.key ? '' : c.key, hex: '' }),
        }),
      );
    }
    picker.value = state.hex || picker.value;
    colorItems.append(h('span.color-picker', picker, h('span.hint', state.hex ? state.hex : '직접 선택')));

    clear(tagItems);
    for (const t of meta?.tags ?? []) {
      const on = state.tags.includes(t.name);
      tagItems.append(
        h(
          'button.chip',
          {
            class: on ? 'on' : '',
            title: t.description ?? '',
            onclick: () => set({ tags: on ? state.tags.filter((x) => x !== t.name) : [...state.tags, t.name] }),
          },
          `#${t.name}`,
          h('span.count', String(t.count)),
        ),
      );
    }

    sortSelect.value = state.sort || 'newest';
    sortSelect.disabled = !!state.hex;
    sortSelect.title = state.hex ? '색상 코드로 찾을 때는 색이 비슷한 순서로 보여줘요' : '';
    if (input.value.trim() !== state.q) input.value = state.q;

    clear(activeEl);
    const chip = (label, clearPatch) => h('button.chip.on', { onclick: () => set(clearPatch), title: '필터 해제' }, label, ' ✕');
    if (state.q) activeEl.append(chip(`"${state.q}"`, { q: '' }));
    if (state.category) activeEl.append(chip(store.category(state.category)?.label ?? state.category, { category: '' }));
    if (state.color) activeEl.append(chip(`🎨 ${store.color(state.color)?.label ?? state.color}`, { color: '' }));
    if (state.hex) activeEl.append(chip(`🎨 ${state.hex}`, { hex: '' }));
    for (const t of state.tags) activeEl.append(chip(`#${t}`, { tags: state.tags.filter((x) => x !== t) }));
    if (state.creator) activeEl.append(chip(`제작자 ${state.creator}`, { creator: '' }));
    if (state.uploader) activeEl.append(chip(`올린 사람 ${state.uploaderName || state.uploader}`, { uploader: '', uploaderName: '' }));
    const any = state.q || state.category || state.color || state.hex || state.tags.length || state.creator || state.uploader;
    if (any) {
      activeEl.append(
        h('button.btn.ghost.sm', { onclick: () => set({ q: '', category: '', color: '', hex: '', tags: [], creator: '', uploader: '', uploaderName: '' }) }, '모두 지우기'),
      );
    }
  }

  function reload() {
    grid?.destroy();
    clear(resultsEl);
    countEl.textContent = '검색 중…';
    const s = { ...state };
    const seed = Math.random().toString(36).slice(2, 10);
    grid = new ResultsGrid({
      load: (page) =>
        api.get('/api/refs', {
          q: s.q,
          category: s.category,
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
        countEl.textContent = `${n.toLocaleString()}개의 레퍼런스`;
      },
      empty: () =>
        emptyState(
          '🔍',
          total ? '조건에 맞는 레퍼런스가 없어요.' : '아직 등록된 레퍼런스가 없어요. 디스코드에서 /업로드 로 첫 레퍼런스를 올려보세요!',
        ),
    });
    resultsEl.append(grid.el);
  }

  function set(patch) {
    Object.assign(state, patch);
    const q = toQuery(state);
    history.replaceState(null, '', `#/${q ? `?${q}` : ''}`);
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
