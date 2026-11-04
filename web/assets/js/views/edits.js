import { api } from '../api.js';
import { emptyState, handleApiError, openOverlay, requireLogin } from '../components.js';
import { avatarSrc, clear, fmtRelative, h, spinner, toast } from '../dom.js';
import { categoryLabel, t } from '../i18n.js';
import { store } from '../store.js';

/** 지금 로그인한 사람이 바로 고칠 수 있는지 (올린 사람 또는 관리자) */
export function canEditRef(ref) {
  const me = store.me;
  return !!me && (me.isAdmin || me.id === ref.uploader.id);
}

const editPoints = () => store.meta?.scoring?.pointsPerEdit ?? 5;

/** 메뉴의 "수정 제안" 숫자를 새로 받아옴 */
export async function refreshMe() {
  try {
    const { user } = await api.get('/api/auth/me');
    store.setMe(user);
  } catch {
    /* 무시 */
  }
}

/**
 * 수정 창. 올린 사람/관리자는 바로 저장, 다른 사람은 수정 제안을 보냄.
 * onDone({ mode, item?, proposal? })
 */
export function openEditForm(ref, { onDone } = {}) {
  if (!requireLogin(t('edit.loginToEdit'))) return;
  const direct = canEditRef(ref);
  const categories = store.meta?.categories ?? [];
  const tagMeta = store.meta?.tags ?? [];

  let category = ref.category;
  const tags = new Set(ref.tags);

  openOverlay(
    (close) => {
      const title = h('input.form-input', { type: 'text', maxlength: 100, value: ref.title });
      const mapName = h('input.form-input', { type: 'text', maxlength: 100, value: ref.mapName ?? '' });
      const creators = h('input.form-input', {
        type: 'text',
        maxlength: 300,
        value: (ref.creators ?? [ref.creator]).map((c) => c.name).join(', '),
      });
      const note = direct ? null : h('textarea.form-input.area', { maxlength: 300, rows: 2, placeholder: t('edit.notePlaceholder') });
      const mapField = field('Map', mapName);

      const catRow = h('div.segmented.wrap');
      const renderCats = () => {
        clear(catRow);
        for (const c of categories) {
          catRow.append(
            h(
              'button',
              {
                type: 'button',
                class: c.key === category ? 'on' : '',
                onclick: () => {
                  category = c.key;
                  renderCats();
                },
              },
              categoryLabel(c),
            ),
          );
        }
        const cat = categories.find((c) => c.key === category);
        mapField.hidden = cat ? !cat.hasMapName : false;
      };
      renderCats();

      const tagRow = h('div.tag-list.edit-tags');
      for (const tg of tagMeta) {
        const chip = h(
          'button.chip',
          {
            type: 'button',
            class: tags.has(tg.name) ? 'on' : '',
            title: tg.description ?? '',
            onclick: () => {
              if (tags.has(tg.name)) tags.delete(tg.name);
              else tags.add(tg.name);
              chip.classList.toggle('on', tags.has(tg.name));
            },
          },
          `#${tg.name}`,
        );
        tagRow.append(chip);
      }

      const submit = h('button.btn.primary', { type: 'submit' }, direct ? t('edit.save') : t('edit.send'));
      const form = h(
        'form.edit-form',
        {
          onsubmit: async (e) => {
            e.preventDefault();
            submit.disabled = true;
            try {
              const res = await api.post(`/api/refs/${ref.id}/edit`, {
                title: title.value,
                category,
                mapName: mapName.value,
                creators: creators.value,
                tags: [...tags],
                ...(note ? { note: note.value } : {}),
              });
              toast(res.mode === 'applied' ? t('edit.saved') : t('edit.sent'), 'ok');
              close();
              onDone?.(res);
            } catch (err) {
              handleApiError(err);
              submit.disabled = false;
            }
          },
        },
        h('h3', direct ? t('edit.titleEdit') : t('edit.titlePropose')),
        h('p.muted', `#${ref.id} · ${direct ? t('edit.editHint') : t('edit.proposeHint', { n: editPoints() })}`),
        field('Title', title),
        field('Category', catRow),
        mapField,
        field('Creators', creators, t('edit.creatorsHint')),
        field('Tags', tagRow),
        note ? field('Note', note) : null,
        h('div.row.form-actions', h('button.btn', { type: 'button', onclick: close }, t('edit.cancel')), submit),
      );
      return form;
    },
    { className: 'panel' },
  );
}

function field(label, control, hint) {
  return h('label.form-field', h('span.form-label', label), control, hint ? h('span.hint', hint) : null);
}

/** 제안 내용을 "원래 → 바뀔 값" 줄로 */
export function proposalDiff(p) {
  const c = p.changes ?? {};
  const b = p.before ?? {};
  const rows = h('dl.diff');
  const row = (k, from, to) => rows.append(h('dt', k), h('dd', from !== undefined ? h('s.faint', from) : null, from !== undefined ? ' → ' : null, h('b', to)));
  const none = t('edit.none');
  if (c.title !== undefined) row('Title', b.title, c.title);
  if (c.category !== undefined) {
    const label = (key) => {
      const cat = store.category(key);
      return cat ? categoryLabel(cat) : key;
    };
    row('Category', b.category ? label(b.category) : undefined, label(c.category));
  }
  if (c.mapName !== undefined) row('Map', b.mapName ?? none, c.mapName ?? none);
  if (c.creators !== undefined) row('Creators', (b.creators ?? []).map((x) => x.name).join(', ') || none, c.creators.map((x) => x.name).join(', '));
  if (c.addTags?.length || c.removeTags?.length) {
    rows.append(
      h('dt', 'Tags'),
      h(
        'dd.diff-tags',
        (c.addTags ?? []).map((tg) => h('span.chip.static.add', `+ #${tg}`)),
        (c.removeTags ?? []).map((tg) => h('span.chip.static.remove', `− #${tg}`)),
      ),
    );
  }
  return rows;
}

/**
 * 제안 하나.
 * mode: 'review' (받아들이기/거절), 'mine' (내가 보낸 것: 취소), 'history' (상태만)
 */
export function proposalCard(p, { mode, onDone, showRef = true } = {}) {
  const actions = h('div.row.proposal-actions');
  const busy = (on) => actions.querySelectorAll('button').forEach((b) => (b.disabled = on));
  if (mode === 'review') {
    actions.append(
      h(
        'button.btn.sm',
        {
          onclick: async () => {
            const reason = window.prompt(t('edit.rejectReason'), '');
            if (reason === null) return;
            busy(true);
            try {
              await api.post(`/api/edits/${p.id}/reject`, { reason });
              toast(t('edit.rejected'), 'ok');
              onDone?.('rejected');
              refreshMe();
            } catch (err) {
              handleApiError(err);
              busy(false);
            }
          },
        },
        t('edit.reject'),
      ),
      h(
        'button.btn.sm.primary',
        {
          onclick: async () => {
            busy(true);
            try {
              const res = await api.post(`/api/edits/${p.id}/accept`);
              toast(t('edit.accepted'), 'ok');
              onDone?.('accepted', res.item);
              refreshMe();
            } catch (err) {
              handleApiError(err);
              busy(false);
            }
          },
        },
        t('edit.accept'),
      ),
    );
  } else if (mode === 'mine' && p.status === 'pending') {
    actions.append(
      h(
        'button.btn.sm',
        {
          onclick: async () => {
            busy(true);
            try {
              await api.post(`/api/edits/${p.id}/cancel`);
              toast(t('edit.withdrawn'), 'ok');
              onDone?.('cancelled');
            } catch (err) {
              handleApiError(err);
              busy(false);
            }
          },
        },
        t('edit.withdraw'),
      ),
    );
  }

  const ref = p.ref;
  return h(
    'div.proposal',
    showRef
      ? ref
        ? h('a.proposal-thumb', { href: `#/ref/${ref.id}` }, h('img', { src: ref.preview.url, alt: '', loading: 'lazy' }))
        : h('div.proposal-thumb.gone', t('edit.deletedRef'))
      : null,
    h(
      'div.proposal-body',
      h(
        'div.proposal-head',
        showRef && ref ? h('a.proposal-title', { href: `#/ref/${ref.id}` }, h('span.id', `#${ref.id}`), ref.title) : null,
        h('span.status', { class: `s-${p.status}` }, t(`edit.status.${p.status}`)),
      ),
      h(
        'div.proposal-who',
        h('img.avatar.xs', { src: avatarSrc(p.proposer.avatarUrl), alt: '' }),
        h('a', { href: `#/user/${p.proposer.id}` }, t('edit.by', { name: p.proposer.name ?? '?' })),
        h('span.faint', ` · ${fmtRelative(p.createdAt)}`),
      ),
      p.note ? h('blockquote.proposal-note', p.note) : null,
      proposalDiff(p),
      actions.childElementCount ? actions : null,
    ),
  );
}

/** "수정 제안" 화면: 받은 제안 / 보낸 제안 */
export function mountEdits(root) {
  document.title = 'Suggested edits · GFX References';
  let tab = 'received';
  let all = false;
  const body = h('div');
  const tabs = h('div.segmented');
  const head = h('div.page-head', h('div', h('h1', 'Edits'), h('p', t('edit.intro', { n: editPoints() }))), tabs);
  root.append(head, body);

  const renderTabs = () => {
    clear(tabs);
    for (const [key, label] of [
      ['received', t('edit.receivedTab')],
      ['sent', t('edit.sentTab')],
    ]) {
      tabs.append(
        h(
          'button',
          {
            class: tab === key ? 'on' : '',
            onclick: () => {
              tab = key;
              renderTabs();
              load();
            },
          },
          label,
          key === 'received' && store.me?.pendingEdits ? h('span.badge', String(store.me.pendingEdits)) : null,
        ),
      );
    }
    if (store.me?.isAdmin && tab === 'received') {
      const box = h('input', {
        type: 'checkbox',
        checked: all,
        onchange: () => {
          all = box.checked;
          load();
        },
      });
      tabs.append(h('label.check', box, t('edit.all')));
    }
  };

  async function load() {
    if (!store.me) {
      clear(body).append(emptyState(t('edit.loginToSee'), h('button.btn.primary', { onclick: () => requireLogin() }, t('account.login'))));
      return;
    }
    clear(body).append(spinner());
    try {
      const res = tab === 'received' ? await api.get('/api/edits/received', { all: all ? 1 : undefined }) : await api.get('/api/edits/sent');
      clear(body);
      if (!res.items.length) {
        body.append(emptyState(tab === 'received' ? t('edit.noneReceived') : t('edit.noneSent')));
        return;
      }
      const list = h('div.proposal-list');
      for (const p of res.items) {
        const card = proposalCard(p, {
          mode: tab === 'received' ? 'review' : 'mine',
          onDone: () => {
            if (tab === 'received') card.remove();
            else load();
            if (!list.childElementCount) load();
          },
        });
        list.append(card);
      }
      body.append(list);
    } catch (err) {
      clear(body).append(emptyState(err.message));
    }
  }

  renderTabs();
  load();
  const off = store.on(() => {
    renderTabs();
  });
  let wasLoggedIn = !!store.me;
  const offLogin = store.on(() => {
    if (!!store.me !== wasLoggedIn) {
      wasLoggedIn = !!store.me;
      load();
    }
  });
  return {
    destroy: () => {
      off();
      offLogin();
    },
  };
}
