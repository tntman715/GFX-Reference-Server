import { api } from '../api.js';
import { emptyState, handleApiError, openLogin, openOverlay, requireLogin } from '../components.js';
import { avatarSrc, clear, fmtRelative, h, spinner, toast } from '../dom.js';
import { getLang, t } from '../i18n.js';
import { store } from '../store.js';
import { refreshMe } from './edits.js';

const REASONS_EN = {
  duplicate: 'Duplicate (already uploaded)',
  wrong_info: 'Wrong tags, creator or name',
  stolen: "Someone else's work posted without permission",
  inappropriate: 'Inappropriate content',
  broken: 'File or original does not open',
  other: 'Other',
};

const reasonLabel = (r) => (getLang() === 'en' ? (REASONS_EN[r.key] ?? r.label) : r.label);

/** 신고 창: type 'ref' | 'resource' | 'showcase' */
export function openReportForm(type, id, label) {
  if (!requireLogin(t('report.login'))) return;
  const reasons = store.meta?.reportReasons ?? [];
  openOverlay(
    (close) => {
      let reason = null;
      const list = h('div.report-reasons');
      const note = h('textarea.form-input.area', { rows: 3, maxlength: 500, placeholder: t('report.notePlaceholder') });
      for (const r of reasons) {
        const input = h('input', {
          type: 'radio',
          name: 'report-reason',
          value: r.key,
          onchange: () => {
            reason = r.key;
          },
        });
        list.append(h('label.report-reason', input, h('span', reasonLabel(r))));
      }
      const submit = h('button.btn.primary', { type: 'submit' }, t('report.send'));
      return h(
        'form.edit-form',
        {
          onsubmit: async (e) => {
            e.preventDefault();
            if (!reason) return toast(t('report.pickReason'), 'error');
            submit.disabled = true;
            try {
              await api.post('/api/reports', { targetType: type, targetId: id, reason, note: note.value });
              toast(t('report.sent'), 'ok');
              close();
            } catch (err) {
              handleApiError(err);
              submit.disabled = false;
            }
          },
        },
        h('h3', t('report.title')),
        h('p.muted', `${label} — ${t('report.lead')}`),
        list,
        note,
        h('div.row.form-actions', h('button.btn', { type: 'button', onclick: close }, t('edit.cancel')), submit),
      );
    },
    { className: 'panel' },
  );
}

/** 관리자: 신고 목록 (#/reports). 관리자 전용이라 한국어로만 */
export function mountReports(root, _params, { navigate }) {
  document.title = 'Reports · GFX References';
  let status = 'open';
  const tabs = h('div.segmented');
  const body = h('div');
  root.append(h('div.page-head', h('div', h('h1', 'Reports'), h('p', '사용자들이 보낸 신고예요. 확인하고 처리하거나 문제 없음으로 닫아 주세요.')), tabs), body);

  if (!store.me?.isAdmin) {
    body.append(
      store.me
        ? emptyState('서버 관리자만 볼 수 있어요.')
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

  const renderTabs = () => {
    clear(tabs);
    for (const [key, label] of [
      ['open', '처리 대기'],
      ['resolved', '처리함'],
      ['dismissed', '문제 없음'],
    ]) {
      tabs.append(
        h(
          'button',
          {
            class: status === key ? 'on' : '',
            onclick: () => {
              status = key;
              renderTabs();
              load();
            },
          },
          label,
        ),
      );
    }
  };

  async function close(r, next) {
    try {
      await api.post(`/api/admin/reports/${r.id}`, { status: next });
      toast(next === 'resolved' ? '처리 완료로 닫았어요.' : '문제 없음으로 닫았어요.', 'ok');
      refreshMe();
      load();
    } catch (err) {
      handleApiError(err);
    }
  }

  async function removeTarget(r) {
    if (!window.confirm(`"${r.target?.title}" 을(를) 지울까요? 되돌릴 수 없어요.`)) return;
    try {
      const path = { ref: 'refs', resource: 'resources', showcase: 'showcase' }[r.targetType] ?? 'refs';
      await api.post(`/api/${path}/${r.targetId}/delete`);
      await api.post(`/api/admin/reports/${r.id}`, { status: 'resolved' });
      toast('지우고 신고를 처리 완료로 닫았어요.', 'ok');
      refreshMe();
      store.refreshMeta().catch(() => undefined);
      load();
    } catch (err) {
      handleApiError(err);
    }
  }

  function card(r) {
    const target = r.target;
    const href = { ref: `#/ref/${r.targetId}`, resource: `#/res/${r.targetId}`, showcase: `#/showcase/${r.targetId}` }[r.targetType] ?? '#/';
    return h(
      'div.proposal',
      target?.imageUrl
        ? h('a.proposal-thumb', { href }, h('img', { src: target.imageUrl, alt: '', loading: 'lazy' }))
        : h('div.proposal-thumb.gone', target ? '미리보기 없음' : '이미 지워짐'),
      h(
        'div.proposal-body',
        h(
          'div.proposal-head',
          target ? h('a.proposal-title', { href }, target.title) : h('span.proposal-title.faint', `${r.targetType} #${r.targetId} (지워짐)`),
          h('span.status', { class: `s-${r.status === 'open' ? 'pending' : r.status === 'resolved' ? 'accepted' : 'rejected'}` }, r.reasonLabel),
        ),
        h(
          'div.proposal-who',
          h('img.avatar.xs', { src: avatarSrc(r.reporter.avatarUrl), alt: '' }),
          h('a', { href: `#/user/${r.reporter.id}` }, `${r.reporter.name ?? '?'} 님의 신고`),
          h('span.faint', ` · ${fmtRelative(r.createdAt)}`),
          target ? h('span.faint', ' · 올린 사람 ', h('a', { href: `#/user/${target.uploaderId}` }, '프로필')) : null,
        ),
        r.note ? h('blockquote.proposal-note', r.note) : null,
        r.status === 'open'
          ? h(
              'div.row.proposal-actions',
              h('button.btn.sm', { onclick: () => close(r, 'dismissed') }, '문제 없음'),
              h('button.btn.sm', { onclick: () => close(r, 'resolved') }, '처리 완료'),
              target ? h('button.btn.sm.danger', { onclick: () => removeTarget(r) }, '지우고 처리') : null,
              target ? h('button.btn.sm.ghost', { onclick: () => navigate(href) }, '열어 보기') : null,
            )
          : null,
      ),
    );
  }

  async function load() {
    clear(body).append(spinner());
    try {
      const { items } = await api.get('/api/admin/reports', { status });
      clear(body);
      if (!items.length) return void body.append(emptyState(status === 'open' ? '처리할 신고가 없어요. 🎉' : '아직 없어요.'));
      body.append(h('div.proposal-list', items.map(card)));
    } catch (err) {
      clear(body).append(emptyState(err.message));
    }
  }

  renderTabs();
  load();
  return {};
}
