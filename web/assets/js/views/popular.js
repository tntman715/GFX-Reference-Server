import { api } from '../api.js';
import { emptyState, ResultsGrid } from '../components.js';
import { clear, h } from '../dom.js';
import { store } from '../store.js';

export function mountPopular(root, params) {
  const state = { period: params.get('period') || 'week', category: params.get('category') || '' };
  let grid = null;
  const periodSeg = h('div.segmented');
  const catSeg = h('div.segmented');
  const results = h('div');

  root.append(
    h(
      'div.page-head',
      h(
        'div',
        h('h1', '🏆 인기 레퍼런스'),
        h('p', `${(store.meta?.reactions ?? []).join(' ')} 반응을 많이 받은 순서예요. 디스코드 아카이브의 반응도 함께 집계돼요.`),
      ),
      periodSeg,
    ),
    h('div', { style: { marginBottom: '18px' } }, catSeg),
    results,
  );

  function render() {
    clear(periodSeg);
    for (const p of store.meta?.periods ?? []) {
      periodSeg.append(h('button', { class: state.period === p.key ? 'on' : '', onclick: () => set({ period: p.key }) }, p.label));
    }
    clear(catSeg);
    catSeg.append(h('button', { class: state.category ? '' : 'on', onclick: () => set({ category: '' }) }, '전체'));
    for (const c of store.meta?.categories ?? []) {
      catSeg.append(h('button', { class: state.category === c.key ? 'on' : '', onclick: () => set({ category: c.key }) }, `${c.emoji} ${c.label}`));
    }
    grid?.destroy();
    clear(results);
    const s = { ...state };
    grid = new ResultsGrid({
      ranked: true,
      load: (page) => api.get('/api/refs', { sort: 'popular', period: s.period, category: s.category, page, limit: 24 }),
      empty: () => emptyState('🏆', '이 기간에 반응을 받은 레퍼런스가 아직 없어요. 마음에 드는 레퍼런스에 반응을 남겨주세요!'),
    });
    results.append(grid.el);
  }

  function set(patch) {
    Object.assign(state, patch);
    const p = new URLSearchParams();
    if (state.period !== 'week') p.set('period', state.period);
    if (state.category) p.set('category', state.category);
    history.replaceState(null, '', `#/popular${p.size ? `?${p}` : ''}`);
    render();
  }

  render();
  return {
    update(params) {
      const next = { period: params.get('period') || 'week', category: params.get('category') || '' };
      if (next.period === state.period && next.category === state.category) return;
      Object.assign(state, next);
      render();
    },
    destroy: () => grid?.destroy(),
  };
}
