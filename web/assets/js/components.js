import { api, ApiError } from './api.js';
import { clear, copyText, h, spinner, toast } from './dom.js';
import { categoryLabel, t } from './i18n.js';
import { store } from './store.js';

// ── 카드 ───────────────────────────────────────────────

export function paletteBar(palette, height) {
  const bar = h('div.palette-bar', height ? { style: { height: `${height}px` } } : null);
  const total = palette.reduce((s, p) => s + p.share, 0) || 1;
  for (const p of palette) bar.append(h('span', { style: { flex: String(p.share / total), background: p.hex } }));
  return bar;
}

const STAR_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>';

export function refCard(ref, { rank } = {}) {
  const categories = store.meta?.categories ?? [];
  const catIndex = categories.findIndex((c) => c.key === ref.category);
  const cat = categories[catIndex] ?? { key: ref.category, label: ref.categoryLabel };
  const img = h('img', {
    src: ref.preview.url,
    alt: `${ref.title}, ${ref.creator.name}`,
    loading: 'lazy',
    decoding: 'async',
    width: ref.preview.width,
    height: ref.preview.height,
  });
  // 다 불러오면 이미지를 보여주고 자리 표시(반짝임)를 멈춤. 실패해도 반짝임은 멈춤
  const markLoaded = () => {
    img.classList.add('loaded');
    img.parentElement?.classList.add('ready');
  };
  img.addEventListener('load', markLoaded, { once: true });
  img.addEventListener('error', () => img.parentElement?.classList.add('ready'), { once: true });
  const reactLabel = rank !== undefined && ref.periodReactions !== undefined ? ref.periodReactions : ref.reactionTotal;
  const card = h(
    'a.card',
    { href: `#/ref/${ref.id}`, title: ref.title, style: { '--c': ref.palette[0]?.hex ?? '#ff7a1a' } },
    h(
      'div.card-media',
      { style: { aspectRatio: `${ref.preview.width} / ${ref.preview.height}`, background: ref.palette[0]?.hex ?? '#111' } },
      img,
      h('span.card-badge', { class: catIndex >= 0 ? `c${catIndex % 3}` : '' }, categoryLabel(cat, true)),
      rank !== undefined ? h('span.card-rank', { class: rank <= 3 ? `r${rank}` : '' }, String(rank)) : null,
    ),
    paletteBar(ref.palette),
    h(
      'div.card-body',
      h('div.card-title', h('span.id', `#${ref.id}`), ref.title),
      h(
        'div.card-meta',
        h('span.who', ref.mapName && ref.mapName !== ref.title ? `${ref.mapName} · ${ref.creator.name}` : ref.creator.name),
        h('span.react', h('span', { html: STAR_ICON }), String(reactLabel)),
      ),
    ),
  );
  if (img.complete) markLoaded();
  return card;
}

// ── 메이슨리 그리드 + 무한 스크롤 ─────────────────────────

/**
 * 결과를 메이슨리로 보여주고, 끝에 닿으면 다음 페이지를 불러옵니다.
 * load(page) → { items, hasMore, total }
 */
export class ResultsGrid {
  constructor({ load, minColWidth = 250, gap = 16, ranked = false, empty, onTotal }) {
    this.load = load;
    this.minColWidth = minColWidth;
    this.gap = gap;
    this.ranked = ranked;
    this.emptyContent = empty;
    this.onTotal = onTotal;
    this.items = [];
    this.page = 0;
    this.hasMore = true;
    this.loading = false;
    this.el = h('div');
    this.grid = h('div.masonry');
    this.footer = h('div.load-more');
    this.el.append(this.grid, this.footer);
    this.cols = [];
    this.heights = [];
    this.token = 0;

    this.resizeObserver = new ResizeObserver(() => {
      if (this.columnCount() !== this.cols.length) this.relayout();
    });
    this.resizeObserver.observe(this.grid);
    this.io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) this.next();
    }, { rootMargin: '800px 0px' });
    this.io.observe(this.footer);
    // 카드가 화면에 들어오면 'in' 을 붙여 차례로 떠오르게 함 (styles.css 의 .card.in)
    this.revealIO =
      'IntersectionObserver' in window
        ? new IntersectionObserver(
            (entries) => {
              const shown = entries.filter((e) => e.isIntersecting);
              shown.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
              shown.forEach((e, k) => {
                e.target.style.setProperty('--i', String(Math.min(k, 10)));
                e.target.classList.add('in');
                this.revealIO.unobserve(e.target);
              });
            },
            { rootMargin: '0px 0px -24px 0px' },
          )
        : null;
    this.next();
  }

  reveal(el) {
    if (this.revealIO) this.revealIO.observe(el);
    else el.classList.add('in');
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.io.disconnect();
    this.revealIO?.disconnect();
    this.token++;
  }

  columnCount() {
    const w = this.grid.clientWidth || this.el.clientWidth || window.innerWidth;
    return Math.max(1, Math.floor((w + this.gap) / (this.minColWidth + this.gap)));
  }

  relayout() {
    clear(this.grid);
    const n = this.columnCount();
    this.cols = Array.from({ length: n }, () => h('div.masonry-col'));
    this.heights = new Array(n).fill(0);
    this.grid.append(...this.cols);
    this.items.forEach((it) => this.place(it));
  }

  place(it) {
    // 열이 아직 없으면 relayout 이 이 카드까지 모두 배치함 (예전엔 첫 카드가 한 번 더 옮겨져 1번이 둘째 칸에 갔음)
    if (!this.cols.length) {
      this.relayout();
      return;
    }
    let idx = 0;
    for (let i = 1; i < this.heights.length; i++) if (this.heights[i] < this.heights[idx] - 0.01) idx = i;
    this.cols[idx].append(it.el);
    this.heights[idx] += it.ratio + 0.32;
  }

  async next() {
    if (this.loading || !this.hasMore) return;
    this.loading = true;
    const token = this.token;
    clear(this.footer).append(spinner());
    try {
      const res = await this.load(this.page + 1);
      if (token !== this.token) return;
      this.page++;
      this.hasMore = res.hasMore;
      if (this.page === 1) this.onTotal?.(res.total);
      const start = this.items.length;
      res.items.forEach((ref, i) => {
        const it = { el: refCard(ref, this.ranked ? { rank: start + i + 1 } : {}), ratio: ref.preview.height / ref.preview.width };
        this.items.push(it);
        this.place(it);
        this.reveal(it.el);
      });
      clear(this.footer);
      if (!this.items.length && this.emptyContent) this.footer.append(this.emptyContent());
      else if (this.hasMore) {
        this.footer.append(h('button.btn.view-all', { onclick: () => this.next() }, h('em', 'View more'), h('span.arrow', { 'aria-hidden': 'true' }, '↓')));
      }
    } catch (err) {
      if (token !== this.token) return;
      clear(this.footer).append(emptyState(err.message || t('grid.error')));
      this.hasMore = false;
    } finally {
      this.loading = false;
    }
  }
}

export function emptyState(text, extra) {
  return h('div.empty', h('div', text), extra ?? null);
}

// ── 오버레이 ───────────────────────────────────────────

export function openOverlay(content, { onClose, small = false } = {}) {
  const root = document.getElementById('overlay-root');
  const sheet = h('div.sheet', { class: small ? 'small' : '' });
  const overlay = h('div.overlay', { role: 'dialog', 'aria-modal': 'true' }, sheet);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    // 닫힘 애니메이션이 끝난 뒤 지움
    overlay.classList.add('closing');
    const remove = () => {
      overlay.remove();
      if (!root.querySelector('.overlay:not(.closing)')) document.body.style.overflow = '';
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) remove();
    else setTimeout(remove, 200);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    const open = root.querySelectorAll('.overlay:not(.closing)');
    if (open[open.length - 1] === overlay) close();
  };
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  sheet.append(h('button.close-btn', { onclick: close, 'aria-label': t('close') }, '×'));
  sheet.append(typeof content === 'function' ? content(close) : content);
  root.append(overlay);
  document.body.style.overflow = 'hidden';
  return { close, sheet };
}

// ── 로그인 ─────────────────────────────────────────────

export function requireLogin(reason) {
  if (store.me) return true;
  openLogin(reason);
  return false;
}

export function openLogin(reason) {
  const meta = store.meta;
  let polling = null;
  const { close } = openOverlay(
    (close) => {
      const body = h('div.login-body');
      const codeArea = h('div');
      body.append(h('h2', 'Log in'), h('p.muted', reason || t('login.reason')));
      if (meta?.auth?.oauth) {
        body.append(
          h(
            'a.btn.discord.block',
            { href: api.loginUrl(window.location.hash ? `/${window.location.hash}` : '/') },
            discordIcon(),
            t('login.oauth'),
          ),
        );
      }
      if (meta?.auth?.deviceCode) {
        if (meta?.auth?.oauth) body.append(h('div.divider', t('login.or')));
        const btn = h(
          'button.btn.block',
          {
            onclick: async () => {
              btn.disabled = true;
              try {
                const res = await api.post('/api/auth/device', { client: 'web' });
                btn.remove();
                showCode(res);
              } catch (err) {
                btn.disabled = false;
                toast(err.message, 'error');
              }
            },
          },
          t('login.device'),
        );
        body.append(btn, codeArea);
      }
      if (!meta?.auth?.oauth && !meta?.auth?.deviceCode) {
        body.append(h('div.empty', t('login.unavailable')));
      }

      function showCode(res) {
        clear(codeArea).append(
          h('p.muted', { style: { margin: '14px 0 0' } }, t('login.typeCommand')),
          h('div.login-code', res.userCode),
          h(
            'div.command-box',
            h('code', res.command),
            h(
              'button.btn.sm',
              {
                onclick: async () => {
                  if (await copyText(res.command)) toast(t('copied'), 'ok');
                },
              },
              t('copy'),
            ),
          ),
          h('p.hint', { style: { marginTop: '10px' } }, t('login.waiting')),
        );
        const started = Date.now();
        polling = setInterval(async () => {
          if (Date.now() - started > 10 * 60_000) {
            clearInterval(polling);
            clear(codeArea).append(h('p.muted', t('login.expired')));
            return;
          }
          try {
            const r = await api.post('/api/auth/device/poll', { deviceCode: res.deviceCode });
            if (r.status === 'approved') {
              clearInterval(polling);
              store.setMe(r.user);
              toast(t('login.done', { name: r.user?.displayName ?? r.user?.username ?? '' }), 'ok');
              close();
            } else if (r.status !== 'pending') {
              clearInterval(polling);
              clear(codeArea).append(h('p.muted', t('login.expired')));
            }
          } catch {
            /* 다음 주기에 다시 */
          }
        }, (res.interval || 3) * 1000);
      }
      return body;
    },
    { small: true, onClose: () => polling && clearInterval(polling) },
  );
  return close;
}

export function discordIcon() {
  const span = h('span', {
    html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1A19.9 19.9 0 0 0 6.1 21l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1L18 21a19.8 19.8 0 0 0 6-3c.5-5.2-.9-9.7-3.7-13.6ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>',
  });
  span.style.display = 'inline-flex';
  return span;
}

/** API 오류를 보여주고, 로그인이 필요하면 로그인 창 */
export function handleApiError(err) {
  if (err instanceof ApiError && err.status === 401) {
    store.setMe(null);
    openLogin();
    return;
  }
  toast(err.message || t('error.generic'), 'error');
}
