import { describe, expect, it } from 'vitest';
import { archivedFile } from '../src/bot/archive.js';
import { commandsJson } from '../src/bot/commands/definitions.js';
import { weekKey } from '../src/bot/highlight.js';
import { discordCanFetch, withUpdatedReactionCounts } from '../src/bot/ui/card.js';

describe('슬래시 명령어 정의', () => {
  const cmds = commandsJson();
  const NAME_RE = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

  function walk(options: any[] | undefined, fn: (o: any) => void) {
    for (const o of options ?? []) {
      fn(o);
      walk(o.options, fn);
    }
  }

  it('디스코드 규칙에 맞는 이름/설명/옵션 순서', () => {
    const names = new Set<string>();
    for (const c of cmds as any[]) {
      expect(c.name).toMatch(NAME_RE);
      expect(c.name_localizations.ko).toMatch(NAME_RE);
      expect(c.description.length).toBeLessThanOrEqual(100);
      expect(names.has(c.name)).toBe(false);
      names.add(c.name);
      walk(c.options, (o) => {
        expect(o.name).toMatch(NAME_RE);
        expect(o.name).toBe(o.name.toLowerCase());
        expect(o.name_localizations?.ko).toMatch(NAME_RE);
        expect(o.description.length).toBeGreaterThan(0);
        expect(o.description.length).toBeLessThanOrEqual(100);
        expect((o.choices ?? []).length).toBeLessThanOrEqual(25);
      });
      // 필수 옵션은 선택 옵션보다 앞에 와야 함
      const check = (opts: any[] = []) => {
        let seenOptional = false;
        for (const o of opts) {
          if (o.type === 1 || o.type === 2) {
            check(o.options);
            continue;
          }
          if (!o.required) seenOptional = true;
          else expect(seenOptional, `${c.name}.${o.name}`).toBe(false);
        }
        expect(opts.length).toBeLessThanOrEqual(25);
      };
      check(c.options);
      // 전체 글자 수 제한 (8000)
      expect(JSON.stringify(c).length).toBeLessThan(8000);
    }
  });

  it('주요 명령어 한국어 이름', () => {
    const ko = Object.fromEntries((cmds as any[]).map((c) => [c.name, c.name_localizations.ko]));
    expect(ko).toMatchObject({ upload: '업로드', search: '검색', random: '랜덤', popular: '인기', leaderboard: '랭킹', link: '연동' });
    const upload = (cmds as any[]).find((c) => c.name === 'upload');
    expect(upload.options.find((o: any) => o.name === 'category').choices.map((c: any) => c.value)).toEqual([
      'gm_thumbnail',
      'gm_artwork',
      'non_gm',
    ]);
    const admin = (cmds as any[]).find((c) => c.name === 'admin');
    expect(admin.default_member_permissions).toBe(String(1 << 5)); // ManageGuild
  });
});

describe('봇 UI 도우미', () => {
  it('디스코드가 가져갈 수 있는 URL 판별', () => {
    expect(discordCanFetch('https://pub-123.r2.dev/previews/a.webp')).toBe(true);
    expect(discordCanFetch('http://example.com/a.webp')).toBe(false);
    expect(discordCanFetch('https://localhost:3000/a.webp')).toBe(false);
    expect(discordCanFetch('https://192.168.0.2/a.webp')).toBe(false);
  });

  it('반응 버튼 숫자 갱신', () => {
    const rows: any[] = [
      { type: 1, components: [{ type: 2, style: 1, custom_id: 'v:abc:1', label: '1/3' }] },
      {
        type: 1,
        components: [
          { type: 2, style: 2, custom_id: 'rx:7:0', label: '0', emoji: { name: '⭐' } },
          { type: 2, style: 2, custom_id: 'rx:7:1', label: '0', emoji: { name: '🔥' } },
          { type: 2, style: 2, custom_id: 'rx:8:0', label: '5', emoji: { name: '⭐' } },
        ],
      },
      { type: 1, components: [{ type: 2, style: 5, url: 'https://x', label: '사이트' }] },
    ];
    const out = withUpdatedReactionCounts(rows, 7, ['⭐', '🔥'], { '⭐': 3 });
    expect(out[1].components.map((c: any) => c.label)).toEqual(['3', '0', '5']);
    expect(out[0]).toEqual(rows[0]);
    expect(out[2]).toEqual(rows[2]);
  });

  it('주간 키는 시간대 기준 월요일', () => {
    // 2026-11-02 는 월요일
    expect(weekKey(new Date('2026-11-02T01:00:00Z'), 'Asia/Seoul')).toBe('2026-11-02');
    expect(weekKey(new Date('2026-11-08T14:59:00Z'), 'Asia/Seoul')).toBe('2026-11-02'); // 일요일 23:59 KST
    expect(weekKey(new Date('2026-11-08T15:00:00Z'), 'Asia/Seoul')).toBe('2026-11-09'); // 월요일 00:00 KST
    expect(weekKey(new Date('2026-11-01T20:00:00Z'), 'Asia/Seoul')).toBe('2026-11-02'); // 월 05:00 KST
    expect(weekKey(new Date('2026-11-01T20:00:00Z'), 'UTC')).toBe('2026-10-26'); // 일요일 UTC
  });
});

describe('아카이브 메시지에서 원본 찾기', () => {
  const att = (list: any[]) => ({ first: () => list[0] });
  const cdn = 'https://cdn.discordapp.com/attachments/1/2/ref-5.png?ex=1&is=2&hm=3';

  it('첨부파일이 있으면 첨부파일', () => {
    const f = archivedFile({ attachments: att([{ url: 'https://cdn.discordapp.com/attachments/1/9/a.png', name: 'a.png', contentType: 'image/png' }]), embeds: [] } as any);
    expect(f).toEqual({ url: 'https://cdn.discordapp.com/attachments/1/9/a.png', name: 'a.png', contentType: 'image/png' });
  });

  it('임베드 이미지로 들어간 원본도 찾음 (디스코드가 첨부파일 목록에서 뺀 경우)', () => {
    const f = archivedFile({ attachments: att([]), embeds: [{ image: { url: cdn } }] } as any);
    expect(f).toEqual({ url: cdn, name: 'ref-5.png', contentType: null });
  });

  it('원본이 아닌 이미지 주소는 무시', () => {
    expect(archivedFile({ attachments: att([]), embeds: [{ image: { url: 'https://media.discordapp.net/attachments/1/2/ref-5.png?width=400' } }] } as any)).toBeNull();
    expect(archivedFile({ attachments: att([]), embeds: [{ image: { url: 'https://example.com/x.png' } }, {}] } as any)).toBeNull();
  });
});
