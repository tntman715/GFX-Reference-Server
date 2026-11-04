import { api } from '../api.js';
import { emptyState, handleApiError, openLogin } from '../components.js';
import { clear, h, toast } from '../dom.js';
import { store } from '../store.js';

/**
 * 관리자: 태그 관리 (#/tags).
 * 태그 이름을 바꾸면 그 태그가 달린 모든 썸네일과 가져오기 후보에 한꺼번에 적용돼요. (관리자 전용이라 한국어로만)
 */
export function mountTags(root) {
  document.title = 'Tags · GFX References';
  const search = h('input.form-input', { type: 'search', placeholder: '태그 찾기', 'aria-label': '태그 찾기' });
  const body = h('div');
  root.append(
    h(
      'div.page-head',
      h('div', h('h1', 'Tags'), h('p', '태그 이름을 바꾸면 그 태그가 달린 썸네일 모두와 가져오기 후보에 바로 적용돼요.')),
      h('div.tag-admin-search', search),
    ),
    body,
  );

  if (!store.me?.isAdmin) {
    body.append(
      store.me
        ? emptyState('서버 관리자만 사용할 수 있어요.')
        : emptyState('관리자 로그인이 필요해요.', h('button.btn.primary', { onclick: () => openLogin() }, '로그인')),
    );
    const off = store.on((s) => {
      if (s.me?.isAdmin) {
        off();
        window.location.reload();
      }
    });
    return { destroy: off };
  }

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const tags = (store.meta?.tags ?? []).filter((t) => !q || t.name.includes(q) || (t.description ?? '').toLowerCase().includes(q));
    clear(body);
    if (!tags.length) return void body.append(emptyState('찾는 태그가 없어요.'));
    body.append(
      h(
        'div.tag-admin-list',
        tags.map((t) =>
          h(
            'div.tag-admin-row',
            h('a.chip', { href: `#/?tags=${encodeURIComponent(t.name)}`, title: '이 태그가 달린 썸네일 보기' }, `#${t.name}`),
            h('span.faint', `${t.count.toLocaleString()}개`),
            h('span.tag-admin-desc.muted', t.description ?? ''),
            h('button.btn.sm', { onclick: () => rename(t) }, '이름 바꾸기'),
          ),
        ),
      ),
    );
  };

  async function rename(tag) {
    const to = window.prompt(
      `"${tag.name}" 의 새 이름\n(썸네일 ${tag.count}개에 함께 적용돼요. 영문 소문자 · 숫자 · 한글, 기호는 / + . _ - 만)`,
      tag.name,
    );
    if (to === null || !to.trim() || to.trim() === tag.name) return;
    try {
      const res = await api.post('/api/admin/tags/rename', { from: tag.name, to });
      toast(`#${res.from} → #${res.to} (썸네일 ${res.refs}개에 적용)`, 'ok');
      await store.refreshMeta();
      render();
    } catch (err) {
      handleApiError(err);
    }
  }

  search.addEventListener('input', render);
  render();
  const off = store.on(render);
  return { destroy: off };
}
