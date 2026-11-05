import { api } from '../api.js';
import { emptyState, handleApiError, openLogin } from '../components.js';
import { clear, h, spinner, toast } from '../dom.js';
import { store } from '../store.js';

/**
 * 관리자: 태그 관리 (#/tags).
 * 레퍼런스 태그와 에셋 · 플러그인 · 텍스쳐팩 태그(탭마다 따로)를 만들고, 이름을 바꾸고, 지웁니다.
 * 이름을 바꾸면 그 태그가 달린 모든 항목에 한꺼번에 적용돼요. (관리자 전용이라 한국어로만)
 */
const KINDS = [
  ['gd', '지메'],
  ['nongd', '비지메'],
  ['asset', '에셋'],
  ['plugin', '플러그인'],
  ['texturepack', '텍스쳐팩'],
];

export function mountTags(root, params) {
  document.title = 'Tags · GFX References';
  let kind = KINDS.some(([k]) => k === params?.get?.('kind')) ? params.get('kind') : 'gd';
  const isRefKind = () => kind === 'gd' || kind === 'nongd';
  const search = h('input.form-input', { type: 'search', placeholder: '태그 찾기', 'aria-label': '태그 찾기' });
  const kindSeg = h('div.segmented');
  const newName = h('input.form-input', { type: 'text', maxlength: 40, placeholder: '새 태그 이름' });
  const newDesc = h('input.form-input', { type: 'text', maxlength: 100, placeholder: '설명 (선택)' });
  const addForm = h(
    'form.tag-admin-new',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!newName.value.trim()) return newName.focus();
        try {
          if (isRefKind()) await api.post('/api/admin/tags', { group: kind, name: newName.value, description: newDesc.value });
          else await api.post('/api/admin/resource-tags', { kind, name: newName.value, description: newDesc.value });
          toast(`#${newName.value.trim()} 태그를 만들었어요.`, 'ok');
          newName.value = '';
          newDesc.value = '';
          await load();
        } catch (err) {
          handleApiError(err);
        }
      },
    },
    newName,
    newDesc,
    h('button.btn.primary', { type: 'submit' }, '만들기'),
  );
  const body = h('div');
  root.append(
    h(
      'div.page-head',
      h('div', h('h1', 'Tags'), h('p', '태그 이름을 바꾸면 그 태그가 달린 모든 항목과 가져오기 후보에 바로 적용돼요. 지메 · 비지메 · 에셋 · 플러그인 · 텍스쳐팩은 태그가 따로 있어요.')),
      h('div.tag-admin-search', search),
    ),
    h('div.tag-admin-bar', kindSeg),
    addForm,
    body,
  );

  if (!store.me?.isAdmin) {
    addForm.remove();
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

  let tags = [];

  const renderKinds = () => {
    clear(kindSeg);
    for (const [k, label] of KINDS) {
      kindSeg.append(
        h(
          'button',
          {
            class: kind === k ? 'on' : '',
            onclick: () => {
              kind = k;
              history.replaceState(null, '', `#/tags${k === 'gd' ? '' : `?kind=${k}`}`);
              renderKinds();
              load();
            },
          },
          label,
        ),
      );
    }
  };

  const listHref = (name) =>
    isRefKind()
      ? `#/${kind === 'nongd' ? 'nongd' : ''}?tags=${encodeURIComponent(name)}`
      : `#/${kind === 'asset' ? 'assets' : kind === 'plugin' ? 'plugins' : 'texturepacks'}?tags=${encodeURIComponent(name)}`;

  const render = () => {
    const q = search.value.trim().toLowerCase();
    const shown = tags.filter((x) => !q || x.name.includes(q) || (x.description ?? '').toLowerCase().includes(q));
    clear(body);
    if (!shown.length) return void body.append(emptyState(tags.length ? '찾는 태그가 없어요.' : '아직 태그가 없어요. 위에서 만들어 주세요.'));
    body.append(
      h(
        'div.tag-admin-list',
        shown.map((x) =>
          h(
            'div.tag-admin-row',
            h('a.chip', { href: listHref(x.name), title: '이 태그가 달린 항목 보기' }, `#${x.name}`),
            h('span.faint', `${x.count.toLocaleString()}개`),
            h('span.tag-admin-desc.muted', x.description ?? ''),
            h(
              'div.row',
              h('button.btn.sm', { onclick: () => rename(x) }, '이름 바꾸기'),
              h('button.btn.sm.danger', { onclick: () => remove(x) }, '지우기'),
            ),
          ),
        ),
      ),
    );
  };

  async function load() {
    clear(body).append(spinner());
    try {
      if (isRefKind()) {
        await store.refreshMeta();
        tags = store.tagsInGroup(kind);
      } else {
        tags = (await api.get('/api/resources/tags', { kind })).tags;
      }
      render();
    } catch (err) {
      clear(body).append(emptyState(err.message));
    }
  }

  async function rename(tag) {
    const to = window.prompt(
      `"${tag.name}" 의 새 이름\n(${tag.count}개 항목에 함께 적용돼요. 영문 소문자 · 숫자 · 한글, 기호는 / + . _ - 만)`,
      tag.name,
    );
    if (to === null || !to.trim() || to.trim() === tag.name) return;
    try {
      const res =
        isRefKind()
          ? await api.post('/api/admin/tags/rename', { group: kind, from: tag.name, to })
          : await api.post('/api/admin/resource-tags/rename', { kind, from: tag.name, to });
      toast(`#${res.from} → #${res.to} (${res.refs}개에 적용)`, 'ok');
      await load();
    } catch (err) {
      handleApiError(err);
    }
  }

  async function remove(tag) {
    if (!window.confirm(`#${tag.name} 태그를 지울까요? 달려 있던 ${tag.count}개 항목에서 빠져요.`)) return;
    try {
      if (isRefKind()) await api.post('/api/admin/tags/delete', { group: kind, name: tag.name });
      else await api.post('/api/admin/resource-tags/delete', { kind, name: tag.name });
      toast(`#${tag.name} 태그를 지웠어요.`, 'ok');
      await load();
    } catch (err) {
      handleApiError(err);
    }
  }

  search.addEventListener('input', render);
  renderKinds();
  load();
  return {};
}
