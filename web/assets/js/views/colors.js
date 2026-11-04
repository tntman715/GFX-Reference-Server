import { api } from '../api.js';
import { emptyState, ResultsGrid } from '../components.js';
import { clear, h, spinner } from '../dom.js';
import { colorLabel, colorNameEn, t } from '../i18n.js';

export function mountColors(root, params) {
  const state = { color: params.get('color') || '', hex: params.get('hex') || '' };
  let grid = null;
  const tiles = h('div.color-tiles', spinner());
  const picker = h('input', { type: 'color', value: state.hex || '#ff3b6b', 'aria-label': t('colors.pick') });
  const text = h('input.text-input', { type: 'text', value: state.hex || '', placeholder: '#ff3b6b', maxlength: 7, 'aria-label': t('colors.code') });
  const title = h('h2', '');
  const results = h('div');

  picker.addEventListener('input', () => (text.value = picker.value));
  picker.addEventListener('change', () => set({ hex: picker.value, color: '' }));
  text.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = text.value.trim();
    const hex = v.startsWith('#') ? v : `#${v}`;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) set({ hex, color: '' });
  });

  root.append(
    h('div.page-head', h('div', h('h1', 'Colors'), h('p', t('colors.lead')))),
    tiles,
    h(
      'div.hex-search',
      picker,
      h('div.hex-text', h('b', 'Custom color'), h('div.hint', t('colors.hint'))),
      text,
      h('button.btn', { onclick: () => text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) }, t('colors.search')),
    ),
    h('div.section-title', title),
    results,
  );

  api.get('/api/colors').then(({ colors }) => {
    clear(tiles);
    for (const c of colors) {
      tiles.append(
        h(
          'button.color-tile',
          { class: state.color === c.key ? 'on' : '', dataset: { key: c.key }, onclick: () => set({ color: c.key, hex: '' }) },
          h('div.sw', { style: { background: c.hex } }),
          h('div.info', h('b', colorLabel(c)), h('span.faint', t('colors.count', { n: c.count }))),
        ),
      );
    }
  });

  function render() {
    for (const tile of tiles.querySelectorAll('.color-tile')) tile.classList.toggle('on', tile.dataset.key === state.color);
    if (state.hex) {
      picker.value = state.hex.length === 4 ? `#${[...state.hex.slice(1)].map((c) => c + c).join('')}` : state.hex;
      text.value = state.hex;
    }
    grid?.destroy();
    clear(results);
    if (!state.color && !state.hex) {
      title.textContent = '';
      results.append(emptyState(t('colors.choose')));
      return;
    }
    // 섹션 제목은 두 언어 모두 영어
    title.textContent = state.color ? colorNameEn(state.color) : state.hex;
    const s = { ...state };
    grid = new ResultsGrid({
      load: (page) => api.get('/api/refs', s.hex ? { hex: s.hex, page, limit: 30 } : { color: s.color, sort: 'color', page, limit: 30 }),
      empty: () => emptyState(t('colors.empty')),
    });
    results.append(grid.el);
  }

  function set(patch) {
    Object.assign(state, patch);
    const p = new URLSearchParams();
    if (state.color) p.set('color', state.color);
    if (state.hex) p.set('hex', state.hex);
    history.replaceState(null, '', `#/colors${p.size ? `?${p}` : ''}`);
    render();
  }

  render();
  return {
    update(params) {
      const next = { color: params.get('color') || '', hex: params.get('hex') || '' };
      if (next.color === state.color && next.hex === state.hex) return;
      Object.assign(state, next);
      render();
    },
    destroy: () => grid?.destroy(),
  };
}
