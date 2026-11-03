import { api } from '../api.js';
import { emptyState } from '../components.js';
import { avatarSrc, clear, h, spinner } from '../dom.js';

export function mountLeaderboard(root, params, { navigate }) {
  let page = Math.max(1, Number(params.get('page')) || 1);
  const body = h('div', spinner());
  const rules = h('p', '');
  root.append(h('div.page-head', h('div', h('h1', '🏆 기여 랭킹'), rules)), body);

  async function load() {
    clear(body).append(spinner());
    try {
      const data = await api.get('/api/leaderboard', { page, limit: 20 });
      rules.textContent = `레퍼런스 업로드 +${data.scoring.pointsPerUpload}점 · 내 레퍼런스가 받은 반응 +${data.scoring.pointsPerReaction}점 (자기 반응 제외)`;
      clear(body);
      if (!data.rows.length) {
        body.append(emptyState('🏆', '아직 랭킹이 없어요. 디스코드에서 /업로드 로 레퍼런스를 올려보세요!'));
        return;
      }
      let rows = data.rows;
      if (page === 1) {
        const top = rows.slice(0, 3);
        rows = rows.slice(3);
        const order = [top[1], top[0], top[2]].filter(Boolean);
        body.append(
          h(
            'div.podium',
            order.map((r) =>
              h(
                'a.p',
                { class: r.rank === 1 ? 'first' : '', href: `#/user/${r.userId}` },
                h('div.medal', r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : '🥉'),
                h('img.avatar.lg', { src: avatarSrc(r.avatarUrl), alt: '' }),
                h('div.name', r.displayName || r.username),
                h('div.score', `${r.score.toLocaleString()}점`),
                h('div.hint', `업로드 ${r.uploads} · 받은 반응 ${r.reactionsReceived}`),
              ),
            ),
          ),
        );
      }
      if (rows.length) {
        body.append(
          h(
            'table.table',
            h(
              'thead',
              h(
                'tr',
                h('th', '순위'),
                h('th', '이름'),
                h('th.num', '점수'),
                h('th.num.hide-sm', '업로드'),
                h('th.num.hide-sm', '받은 반응'),
                h('th.num.hide-sm', '보너스'),
              ),
            ),
            h(
              'tbody',
              rows.map((r) =>
                h(
                  'tr',
                  { onclick: () => navigate(`#/user/${r.userId}`) },
                  h('td.rank-cell', String(r.rank)),
                  h('td', h('div.who-cell', h('img.avatar', { src: avatarSrc(r.avatarUrl), alt: '' }), r.displayName || r.username)),
                  h('td.num', h('b', r.score.toLocaleString())),
                  h('td.num.hide-sm', String(r.uploads)),
                  h('td.num.hide-sm', String(r.reactionsReceived)),
                  h('td.num.hide-sm', r.adjustments ? (r.adjustments > 0 ? `+${r.adjustments}` : String(r.adjustments)) : '—'),
                ),
              ),
            ),
          ),
        );
      }
      const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (pages > 1) {
        body.append(
          h(
            'div.pager',
            h('button.btn.sm', { disabled: page <= 1, onclick: () => go(page - 1) }, '◀ 이전'),
            h('span.muted', `${page} / ${pages}`),
            h('button.btn.sm', { disabled: page >= pages, onclick: () => go(page + 1) }, '다음 ▶'),
          ),
        );
      }
    } catch (err) {
      clear(body).append(emptyState('⚠️', err.message));
    }
  }

  function go(p) {
    page = p;
    history.replaceState(null, '', `#/leaderboard${page > 1 ? `?page=${page}` : ''}`);
    load();
  }

  load();
  return {
    update(params) {
      const p = Math.max(1, Number(params.get('page')) || 1);
      if (p !== page) {
        page = p;
        load();
      }
    },
  };
}
