import { api } from '../api.js';
import { boardCover, emptyState, handleApiError, requireLogin, ResultsGrid } from '../components.js';
import { avatarSrc, clear, h, spinner, toast } from '../dom.js';
import { t } from '../i18n.js';
import { store } from '../store.js';

/** 보드 목록 (표지 4장 + 이름 + 개수) */
export function boardGrid(items) {
  return h(
    'div.board-grid',
    items.map((b) =>
      h(
        'a.board-tile',
        { href: `#/board/${b.id}` },
        boardCover(b),
        h('span.board-name', b.name),
        h('span.faint', t('board.count', { n: b.count.toLocaleString() })),
      ),
    ),
  );
}

/** 내 보드 (#/boards) */
export function mountBoards(root) {
  document.title = 'Boards · GFX References';
  const body = h('div');
  const input = h('input.form-input', { type: 'text', maxlength: 40, placeholder: t('board.newPlaceholder') });
  const createBtn = h('button.btn.primary', { type: 'submit' }, t('board.create'));
  const form = h(
    'form.board-new',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!requireLogin(t('board.loginToSee'))) return;
        const name = input.value.trim();
        if (!name) return input.focus();
        createBtn.disabled = true;
        try {
          const { item } = await api.post('/api/boards', { name });
          toast(t('board.created', { name: item.name }), 'ok');
          input.value = '';
          load();
        } catch (err) {
          handleApiError(err);
        } finally {
          createBtn.disabled = false;
        }
      },
    },
    input,
    createBtn,
  );
  root.append(h('div.page-head', h('div', h('h1', 'Boards'), h('p', t('board.intro'))), form), body);

  async function load() {
    if (!store.me) {
      clear(body).append(emptyState(t('board.loginToSee'), h('button.btn.primary', { onclick: () => requireLogin() }, t('account.login'))));
      return;
    }
    clear(body).append(spinner());
    try {
      const { items } = await api.get('/api/boards');
      clear(body).append(items.length ? boardGrid(items) : emptyState(t('board.mineEmpty')));
    } catch (err) {
      clear(body).append(emptyState(err.message));
    }
  }

  load();
  let wasLoggedIn = !!store.me;
  const off = store.on(() => {
    if (!!store.me !== wasLoggedIn) {
      wasLoggedIn = !!store.me;
      load();
    }
  });
  return { destroy: off };
}

/** 보드 하나 (#/board/:id) — 누구나 볼 수 있고, 주인은 이름 바꾸기/지우기 */
export function mountBoard(root, _params, { id, navigate }) {
  const head = h('div', spinner());
  const gridEl = h('div');
  root.append(head, gridEl);
  let grid = null;
  let board = null;

  const startGrid = () => {
    grid?.destroy();
    clear(gridEl);
    grid = new ResultsGrid({
      load: (page) => api.get(`/api/boards/${id}/refs`, { page, limit: 24 }),
      empty: () => emptyState(t('board.empty')),
    });
    gridEl.append(grid.el);
  };

  const renderHead = () => {
    const mine = store.me?.id === board.owner.id;
    document.title = `${board.name} · GFX References`;
    clear(head).append(
      h(
        'div.page-head',
        h(
          'div',
          h('h1', board.name),
          h(
            'p.board-owner',
            h('a.user-link', { href: `#/user/${board.owner.id}` }, h('img', { src: avatarSrc(board.owner.avatarUrl), alt: '' }), t('board.by', { name: board.owner.name ?? '?' })),
            h('span.faint', ` · ${t('board.count', { n: board.count.toLocaleString() })}`),
          ),
        ),
        mine
          ? h(
              'div.row',
              h(
                'button.btn.sm',
                {
                  onclick: async () => {
                    const name = window.prompt(t('board.renamePrompt'), board.name);
                    if (!name || name.trim() === board.name) return;
                    try {
                      board = (await api.post(`/api/boards/${id}`, { name })).item;
                      renderHead();
                    } catch (err) {
                      handleApiError(err);
                    }
                  },
                },
                t('board.rename'),
              ),
              h(
                'button.btn.sm',
                {
                  onclick: async () => {
                    if (!window.confirm(t('board.deleteConfirm', { name: board.name }))) return;
                    try {
                      await api.post(`/api/boards/${id}/delete`);
                      toast(t('board.deleted'), 'ok');
                      navigate('#/boards');
                    } catch (err) {
                      handleApiError(err);
                    }
                  },
                },
                t('board.delete'),
              ),
            )
          : null,
      ),
    );
  };

  api
    .get(`/api/boards/${id}`)
    .then(({ item }) => {
      board = item;
      renderHead();
      startGrid();
    })
    .catch((err) => clear(head).append(emptyState(err.message)));

  return { destroy: () => grid?.destroy() };
}

/** 프로필에 붙이는 보드 목록 (없으면 아무것도 안 보임) */
export function profileBoards(userId) {
  const el = h('div');
  api
    .get('/api/boards', { owner: userId })
    .then(({ items }) => {
      if (!items.length) return;
      el.append(h('div.section-title', h('h2', 'Boards')), boardGrid(items));
    })
    .catch(() => undefined);
  return el;
}
