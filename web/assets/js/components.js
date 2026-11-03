import { api, ApiError } from './api.js';
import { clear, copyText, h, spinner, toast } from './dom.js';
import { store } from './store.js';

// ── 카드 ───────────────────────────────────────────────

export function paletteBar(palette, height) {
  const bar = h('div.palette-bar', height ? { style: { height: `${height}px` } } : null);
  const total = palette.reduce((s, p) => s + p.share, 0) || 1;
  for (const p of palette) bar.append(h('span', { style: { flex: String(p.share / total), background: p.hex } }));
  return bar;
}

export function refCard(ref, { rank } = {}) {
  const cat = store.category(ref.category);
  const img = h('img', {
    src: ref.preview.url,
    alt: `${ref.title} — ${ref.creator.name}`,
    loading: 'lazy',
    decoding: 'async',
    width: ref.preview.width,
    height: ref.preview.height,
  });
  img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
  if (img.complete) img.classList.add('loaded');
  const reactLabel = rank !== undefined && ref.periodReactions !== undefined ? ref.periodReactions : ref.reactionTotal;
  return h(
    'a.card',
    { href: `#/ref/${ref.id}`, title: ref.title },
    h(
      'div.card-media',
      { style: { aspectRatio: `${ref.preview.width} / ${ref.preview.height}`, background: ref.palette[0]?.hex ?? '#111' } },
      img,
      h('span.card-badge', `${cat?.emoji ?? ''} ${cat?.shortLabel ?? ref.categoryLabel}`),
      rank !== undefined ? h('span.card-rank', { class: rank <= 3 ? `r${rank}` : '' }, String(rank)) : null,
    ),
    paletteBar(ref.palette),
    h(
      'div.card-body',
      h('div.card-title', h('span.id', `#${ref.id}`), ref.title),
      h(
        'div.card-meta',
        h('span.who', ref.mapName && ref.mapName !== ref.title ? `${ref.mapName} · ${ref.creator.name}` : ref.creator.name),
        h('span.react', `${store.meta?.reactions?.[0] ?? '⭐'} ${reactLabel}`),
      ),
    ),
  );
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
    this.next();
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.io.disconnect();
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
    if (!this.cols.length) this.relayout();
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
      });
      clear(this.footer);
      if (!this.items.length && this.emptyContent) this.footer.append(this.emptyContent());
      else if (this.hasMore) this.footer.append(h('button.btn', { onclick: () => this.next() }, '더 보기'));
    } catch (err) {
      if (token !== this.token) return;
      clear(this.footer).append(h('div.empty', h('div.big', '⚠️'), err.message || '불러오지 못했어요.'));
      this.hasMore = false;
    } finally {
      this.loading = false;
    }
  }
}

export function emptyState(emoji, text, extra) {
  return h('div.empty', h('div.big', emoji), h('div', text), extra ?? null);
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
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (!root.children.length) document.body.style.overflow = '';
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && root.lastElementChild === overlay) close();
  };
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  sheet.append(h('button.close-btn', { onclick: close, 'aria-label': '닫기' }, '×'));
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
      const body = h('div');
      const codeArea = h('div');
      body.append(
        h('h2', { style: { fontSize: '22px' } }, '디스코드로 로그인'),
        h(
          'p.muted',
          { style: { margin: '6px 0 18px' } },
          reason || '원본 다운로드와 반응은 GFX References 디스코드 서버 멤버만 사용할 수 있어요.',
        ),
      );
      if (meta?.auth?.oauth) {
        body.append(
          h(
            'a.btn.discord.block',
            { href: api.loginUrl(window.location.hash ? `/${window.location.hash}` : '/') },
            discordIcon(),
            'Discord 계정으로 로그인',
          ),
        );
      }
      if (meta?.auth?.deviceCode) {
        if (meta?.auth?.oauth) body.append(h('div.divider', '또는'));
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
          '🔑 디스코드 명령어 코드로 로그인',
        );
        body.append(btn, codeArea);
      }
      if (!meta?.auth?.oauth && !meta?.auth?.deviceCode) {
        body.append(h('div.empty', '지금은 로그인할 수 없어요. 디스코드 봇이 오프라인이에요.'));
      }

      function showCode(res) {
        clear(codeArea).append(
          h('p.muted', { style: { margin: '14px 0 0' } }, '디스코드 아무 채널에서 아래 명령어를 입력하세요:'),
          h('div.login-code', res.userCode),
          h(
            'div.command-box',
            h('code', res.command),
            h(
              'button.btn.sm',
              {
                onclick: async () => {
                  if (await copyText(res.command)) toast('복사했어요!', 'ok');
                },
              },
              '복사',
            ),
          ),
          h('p.hint', { style: { marginTop: '10px' } }, '⏳ 승인을 기다리는 중… (10분 안에 입력해 주세요)'),
        );
        const started = Date.now();
        polling = setInterval(async () => {
          if (Date.now() - started > 10 * 60_000) {
            clearInterval(polling);
            clear(codeArea).append(h('p.muted', '코드가 만료되었어요. 다시 시도해 주세요.'));
            return;
          }
          try {
            const r = await api.post('/api/auth/device/poll', { deviceCode: res.deviceCode });
            if (r.status === 'approved') {
              clearInterval(polling);
              store.setMe(r.user);
              toast(`${r.user?.displayName ?? r.user?.username ?? ''}님, 로그인했어요!`, 'ok');
              close();
            } else if (r.status !== 'pending') {
              clearInterval(polling);
              clear(codeArea).append(h('p.muted', '코드가 만료되었어요. 다시 시도해 주세요.'));
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
  toast(err.message || '오류가 발생했어요.', 'error');
}
