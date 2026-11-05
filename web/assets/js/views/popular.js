import { api } from '../api.js';
import { emptyState, ResultsGrid } from '../components.js';
import { clear, h } from '../dom.js';
import { categoryLabel, periodLabel, t } from '../i18n.js';
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
        h('h1', 'Popular'),
        h(
          'p',
          t('popular.lead', {
            r: (store.meta?.reactions ?? [])
              .map((e) => `${e} ${store.meta?.scoring?.reactionPoints?.[e] ?? store.meta?.scoring?.pointsPerReaction ?? 1}`)
              .join(' · '),
          }),
        ),
      ),
      periodSeg,
    ),
    h('div.sub-filters', catSeg),
    results,
  );

  function render() {
    clear(periodSeg);
    for (const p of store.meta?.periods ?? []) {
      periodSeg.append(h('button', { class: state.period === p.key ? 'on' : '', onclick: () => set({ period: p.key }) }, periodLabel(p)));
    }
    clear(catSeg);
    catSeg.append(h('button', { class: state.category ? '' : 'on', onclick: () => set({ category: '' }) }, t('all')));
    for (const c of store.meta?.categories ?? []) {
      catSeg.append(h('button', { class: state.category === c.key ? 'on' : '', onclick: () => set({ category: c.key }) }, categoryLabel(c)));
    }
    grid?.destroy();
    clear(results);
    const s = { ...state };
    grid = new ResultsGrid({
      ranked: true,
      load: (page) => api.get('/api/refs', { sort: 'popular', period: s.period, category: s.category, page, limit: 24 }),
      empty: () => emptyState(t('popular.empty')),
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
