import crypto from 'node:crypto';
import type { Db } from '../db/index.js';
import { logger } from '../util/log.js';

const log = logger('site-stats');

/**
 * 방문 통계 (관리자 전용 화면용). 하루 합계 숫자만 DB 에 남깁니다.
 *
 * 개인 정보를 남기지 않는 방법:
 *  - IP 주소 · 브라우저 정보 · 디스코드 계정은 저장하지 않습니다. 쿠키도 쓰지 않습니다.
 *  - "오늘 이미 센 방문자인지" 구분하려고 IP + 브라우저 정보를 그날만 쓰는 무작위 값과 섞어
 *    되돌릴 수 없는 값(해시)으로 만들고, 그 값도 메모리에만 두었다가 날짜가 바뀌면 통째로 버립니다.
 *    무작위 값도 저장하지 않으므로 나중에 누구였는지 거꾸로 알아낼 수 없습니다.
 *  - DB 에는 (날짜, 항목, 값, 횟수) 숫자만 들어갑니다. 예) 2026-11-06 · page · showcase · 42
 */

export const STAT_PAGES = [
  'explore',
  'nongd',
  'feed',
  'popular',
  'colors',
  'ranking',
  'assets',
  'plugins',
  'texturepacks',
  'showcase',
  'detail',
  'resource',
  'profile',
  'upload',
  'boards',
  'tags',
  'edits',
  'import',
  'reports',
  'stats',
  'privacy',
  'other',
] as const;

const REFERRERS: [RegExp, string][] = [
  [/(^|\.)(discord\.com|discordapp\.com|discord\.gg)$/, 'discord'],
  [/(^|\.)google\.[a-z.]+$/, 'google'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)(twitter\.com|x\.com|t\.co)$/, 'x'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)(naver\.com|daum\.net|kakao\.com)$/, 'korean-portal'],
  [/(^|\.)(bing\.com|duckduckgo\.com|yahoo\.com)$/, 'search-other'],
];

const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embed|curl|wget|python|node-fetch|axios|headless/i;
const MAX_VIEWS_PER_VISITOR = 500;

export interface ViewInput {
  page?: unknown;
  lang?: unknown;
  /** 사이트에 처음 들어온 순간 (그때만 어디서 왔는지 셈) */
  first?: unknown;
  referrer?: unknown;
}

export interface StatsSummary {
  days: number;
  from: string;
  to: string;
  daily: { day: string; views: number; visitors: number; members: number }[];
  totals: { views: number; visitors: number; members: number };
  pages: { key: string; count: number }[];
  devices: { key: string; count: number }[];
  langs: { key: string; count: number }[];
  referrers: { key: string; count: number }[];
  activity: {
    daily: { day: string; uploads: number; reactions: number; newUsers: number; resources: number; showcases: number }[];
    totals: { uploads: number; reactions: number; newUsers: number; resources: number; showcases: number; editsAccepted: number; reports: number; contributors: number };
    topTags: { name: string; count: number }[];
  };
  overall: { refs: number; users: number; resources: number; showcases: number };
}

export class SiteStats {
  private day = '';
  private salt = crypto.randomBytes(32);
  /** 오늘 이미 센 방문자 (되돌릴 수 없는 값 → 오늘 본 페이지 수) */
  private visitors = new Map<string, number>();
  private members = new Set<string>();
  /** 아직 DB 에 안 쓴 숫자: "day|metric|key" → 횟수 */
  private pending = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly opts: { timezone: string; now?: () => Date },
  ) {}

  private today(): string {
    const d = this.opts.now?.() ?? new Date();
    // en-CA 는 YYYY-MM-DD 모양
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.opts.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }

  /** 날짜가 바뀌면 방문자 구분용 값을 모두 버리고 새 무작위 값으로 */
  private rollDay(): string {
    const day = this.today();
    if (day !== this.day) {
      this.day = day;
      this.salt = crypto.randomBytes(32);
      this.visitors.clear();
      this.members.clear();
    }
    return day;
  }

  private bump(day: string, metric: string, key = '', n = 1) {
    const k = `${day}|${metric}|${key}`;
    this.pending.set(k, (this.pending.get(k) ?? 0) + n);
  }

  private hash(...parts: string[]): string {
    const h = crypto.createHmac('sha256', this.salt);
    for (const p of parts) h.update(p).update('\0');
    return h.digest('base64url').slice(0, 22);
  }

  /** 페이지 하나 본 것을 셈. ip · ua 는 여기서만 쓰고 어디에도 남기지 않음 */
  record(input: ViewInput, client: { ip: string; ua: string; userId?: string | null }): boolean {
    if (!client.ua || BOT_UA.test(client.ua)) return false;
    const day = this.rollDay();
    const visitor = this.hash(client.ip, client.ua);
    const seen = this.visitors.get(visitor) ?? 0;
    if (seen >= MAX_VIEWS_PER_VISITOR) return false;
    this.visitors.set(visitor, seen + 1);

    const page = typeof input.page === 'string' && (STAT_PAGES as readonly string[]).includes(input.page) ? input.page : 'other';
    this.bump(day, 'views');
    this.bump(day, 'page', page);
    if (seen === 0) {
      this.bump(day, 'visitors');
      this.bump(day, 'device', deviceOf(client.ua));
      this.bump(day, 'lang', input.lang === 'ko' || input.lang === 'en' ? input.lang : 'other');
    }
    if (input.first === true) this.bump(day, 'referrer', referrerOf(input.referrer));
    if (client.userId) {
      // 로그인한 사람 수도 같은 방법으로 (누구인지는 남기지 않고 숫자만)
      const m = this.hash('member', client.userId);
      if (!this.members.has(m)) {
        this.members.add(m);
        this.bump(day, 'members');
      }
    }
    return true;
  }

  /** 모아 둔 숫자를 DB 에 더함 (1분마다 · 서버를 끌 때) */
  async flush(): Promise<void> {
    if (!this.pending.size) return;
    const rows = [...this.pending.entries()];
    this.pending.clear();
    try {
      await this.db.tx(async (q) => {
        for (const [k, n] of rows) {
          const [day, metric, key] = k.split('|');
          await q.query(
            `INSERT INTO site_stats_daily (day, metric, key, count) VALUES ($1, $2, $3, $4)
             ON CONFLICT (day, metric, key) DO UPDATE SET count = site_stats_daily.count + EXCLUDED.count`,
            [day, metric, key, n],
          );
        }
      });
    } catch (err) {
      log.warn('방문 통계 저장 실패 (다음에 다시 시도)', err);
      for (const [k, n] of rows) this.pending.set(k, (this.pending.get(k) ?? 0) + n);
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), 60_000);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  /** 관리자 화면: 최근 N일 방문 합계 + 활동 통계 */
  async summary(daysRaw: number): Promise<StatsSummary> {
    await this.flush();
    const days = [7, 30, 90, 365].includes(daysRaw) ? daysRaw : 30;
    const to = this.today();
    const fromDate = new Date(`${to}T00:00:00Z`);
    fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
    const from = fromDate.toISOString().slice(0, 10);
    const dayList: string[] = [];
    for (let d = new Date(fromDate); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) dayList.push(d.toISOString().slice(0, 10));

    const rows = await this.db.query<{ day: string | Date; metric: string; key: string; count: number }>(
      `SELECT day::text AS day, metric, key, count FROM site_stats_daily WHERE day BETWEEN $1 AND $2`,
      [from, to],
    );
    const byDay = new Map(dayList.map((d) => [d, { day: d, views: 0, visitors: 0, members: 0 }]));
    const groups: Record<string, Map<string, number>> = { page: new Map(), device: new Map(), lang: new Map(), referrer: new Map() };
    for (const r of rows) {
      const day = String(r.day).slice(0, 10);
      const n = Number(r.count);
      const d = byDay.get(day);
      if (d && (r.metric === 'views' || r.metric === 'visitors' || r.metric === 'members')) d[r.metric] += n;
      const g = groups[r.metric];
      if (g) g.set(r.key, (g.get(r.key) ?? 0) + n);
    }
    const sorted = (m: Map<string, number>) => [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
    const daily = [...byDay.values()];
    const sum = (k: 'views' | 'visitors' | 'members') => daily.reduce((s, d) => s + d[k], 0);

    return {
      days,
      from,
      to,
      daily,
      totals: { views: sum('views'), visitors: sum('visitors'), members: sum('members') },
      pages: sorted(groups.page),
      devices: sorted(groups.device),
      langs: sorted(groups.lang),
      referrers: sorted(groups.referrer),
      activity: await this.activity(from, to, dayList),
      overall: await this.overall(),
    };
  }

  private async activity(from: string, to: string, dayList: string[]): Promise<StatsSummary['activity']> {
    const tz = this.opts.timezone;
    const perDay = async (table: string, extra = '') => {
      const rows = await this.db.query<{ day: string; n: number }>(
        `SELECT (created_at AT TIME ZONE $3)::date::text AS day, count(*)::int AS n FROM ${table}
         WHERE (created_at AT TIME ZONE $3)::date BETWEEN $1 AND $2 ${extra} GROUP BY 1`,
        [from, to, tz],
      );
      return new Map(rows.map((r) => [String(r.day).slice(0, 10), Number(r.n)]));
    };
    const [uploads, reactions, newUsers, resources, showcases] = await Promise.all([
      perDay('refs'),
      perDay('reactions'),
      perDay('users'),
      perDay('resources'),
      perDay('showcases'),
    ]);
    const count = async (sql: string) => Number((await this.db.query<{ n: number }>(sql, [from, to, tz]))[0]?.n ?? 0);
    const inRange = (col: string) => `(${col} AT TIME ZONE $3)::date BETWEEN $1 AND $2`;
    const [editsAccepted, reports, contributors] = await Promise.all([
      count(`SELECT count(*)::int AS n FROM edit_proposals WHERE status = 'accepted' AND ${inRange('decided_at')}`),
      count(`SELECT count(*)::int AS n FROM reports WHERE ${inRange('created_at')}`),
      count(
        `SELECT count(DISTINCT u)::int AS n FROM (
           SELECT uploader_id AS u FROM refs WHERE ${inRange('created_at')}
           UNION SELECT uploader_id FROM resources WHERE ${inRange('created_at')}
           UNION SELECT added_by FROM showcases WHERE ${inRange('created_at')}
         ) x`,
      ),
    ]);
    const topTags = await this.db.query<{ name: string; n: number }>(
      `SELECT t.name, count(*)::int AS n FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id JOIN refs r ON r.id = rt.ref_id
       WHERE ${inRange('r.created_at')} GROUP BY t.name ORDER BY n DESC, t.name LIMIT 10`,
      [from, to, tz],
    );
    const daily = dayList.map((day) => ({
      day,
      uploads: uploads.get(day) ?? 0,
      reactions: reactions.get(day) ?? 0,
      newUsers: newUsers.get(day) ?? 0,
      resources: resources.get(day) ?? 0,
      showcases: showcases.get(day) ?? 0,
    }));
    const total = (k: 'uploads' | 'reactions' | 'newUsers' | 'resources' | 'showcases') => daily.reduce((s, d) => s + d[k], 0);
    return {
      daily,
      totals: {
        uploads: total('uploads'),
        reactions: total('reactions'),
        newUsers: total('newUsers'),
        resources: total('resources'),
        showcases: total('showcases'),
        editsAccepted,
        reports,
        contributors,
      },
      topTags: topTags.map((r) => ({ name: r.name, count: Number(r.n) })),
    };
  }

  private async overall(): Promise<StatsSummary['overall']> {
    const rows = await this.db.query<{ refs: number; users: number; resources: number; showcases: number }>(
      `SELECT (SELECT count(*)::int FROM refs) AS refs, (SELECT count(*)::int FROM users) AS users,
              (SELECT count(*)::int FROM resources) AS resources, (SELECT count(*)::int FROM showcases) AS showcases`,
    );
    const r = rows[0];
    return { refs: Number(r?.refs ?? 0), users: Number(r?.users ?? 0), resources: Number(r?.resources ?? 0), showcases: Number(r?.showcases ?? 0) };
  }
}

export function deviceOf(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** 어디서 왔는지는 정해진 몇 가지 이름으로만 (주소 전체는 남기지 않음) */
export function referrerOf(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return 'direct';
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'other';
  }
  for (const [re, name] of REFERRERS) if (re.test(host)) return name;
  return 'other';
}
