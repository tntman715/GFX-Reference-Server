import { api } from '../api.js';
import { emptyState, ResultsGrid } from '../components.js';
import { clear, h, spinner } from '../dom.js';
import { store } from '../store.js';

export function mountColors(root, params) {
  const state = { color: params.get('color') || '', hex: params.get('hex') || '' };
  let grid = null;
  const tiles = h('div.color-tiles', spinner());
  const picker = h('input', { type: 'color', value: state.hex || '#ff3b6b', 'aria-label': '색 선택' });
  const text = h('input.text-input', { type: 'text', value: state.hex || '', placeholder: '#ff3b6b', maxlength: 7, 'aria-label': '색상 코드' });
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
    h('div.page-head', h('div', h('h1', '🎨 색상으로 찾기'), h('p', '대표 색 계열로 모아보거나, 원하는 색을 골라 그 색이 들어간 레퍼런스를 찾을 수 있어요.'))),
    tiles,
    h(
      'div.hex-search',
      picker,
      h('div', { style: { flex: '1', minWidth: '200px' } }, h('b', '원하는 색으로 찾기'), h('div.hint', '색을 고르거나 코드를 입력하고 Enter')),
      text,
      h('button.btn', { onclick: () => text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) }, '찾기'),
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
          h('div.info', h('b', c.label), h('span.faint', `${c.count}개`)),
        ),
      );
    }
  });

  function render() {
    for (const t of tiles.querySelectorAll('.color-tile')) t.classList.toggle('on', t.dataset.key === state.color);
    if (state.hex) {
      picker.value = state.hex.length === 4 ? `#${[...state.hex.slice(1)].map((c) => c + c).join('')}` : state.hex;
      text.value = state.hex;
    }
    grid?.destroy();
    clear(results);
    if (!state.color && !state.hex) {
      title.textContent = '';
      results.append(emptyState('🎨', '위에서 색 계열을 고르거나 원하는 색을 선택해 보세요.'));
      return;
    }
    title.textContent = state.hex ? `${state.hex} 이(가) 들어간 레퍼런스` : '';
    if (state.color) title.textContent = `${store.color(state.color)?.label ?? state.color} 계열 레퍼런스`;
    const s = { ...state };
    grid = new ResultsGrid({
      load: (page) => api.get('/api/refs', s.hex ? { hex: s.hex, page, limit: 30 } : { color: s.color, sort: 'color', page, limit: 30 }),
      empty: () => emptyState('🎨', '이 색이 들어간 레퍼런스가 없어요.'),
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
