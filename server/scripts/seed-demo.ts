/**
 * 디스코드 없이 사이트/플러그인을 둘러볼 수 있도록 데모 레퍼런스를 만듭니다.
 *
 *   BOT_ENABLED=false ARCHIVE_DRIVER=local npm run seed:demo
 *
 * 실제 이미지가 아니라 SVG 로 그린 가짜 썸네일입니다.
 */
import sharp from 'sharp';
import { createContext } from '../src/app.js';
import { loadConfig, loadDotEnv } from '../src/config.js';
import type { Category } from '../src/constants.js';
import type { UserInfo } from '../src/types.js';

loadDotEnv();
const config = loadConfig({ ...process.env, ARCHIVE_DRIVER: 'local', BOT_ENABLED: 'false' });
const ctx = await createContext(config);

const users: UserInfo[] = [
  { id: '300000000000000001', username: 'nova', displayName: 'Nova', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png' },
  { id: '300000000000000002', username: 'kairo', displayName: '카이로', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png' },
  { id: '300000000000000003', username: 'mint', displayName: '민트', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/2.png' },
  { id: '300000000000000004', username: 'vex', displayName: 'Vex', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/3.png' },
  { id: '300000000000000005', username: 'luma', displayName: '루마', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/4.png' },
];

let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

const palettes = [
  ['#0b0014', '#ff2d55', '#ffb3c1'],
  ['#020617', '#38bdf8', '#e0f2fe'],
  ['#0a0a0a', '#facc15', '#fff7cc'],
  ['#1a0533', '#a855f7', '#f0abfc'],
  ['#03140c', '#22c55e', '#bbf7d0'],
  ['#1f0a00', '#f97316', '#fed7aa'],
  ['#001219', '#14b8a6', '#99f6e4'],
  ['#111111', '#e5e5e5', '#737373'],
  ['#2b0012', '#ec4899', '#fbcfe8'],
  ['#0f172a', '#6366f1', '#f43f5e'],
  ['#f8fafc', '#0f172a', '#ef4444'],
  ['#1e1b4b', '#f59e0b', '#38bdf8'],
];

const maps = ['Bloodbath', 'Sonic Wave', 'Tartarus', 'Acheron', 'Slaughterhouse', 'Kocmoc', 'Nine Circles', 'Silent Clubstep', 'Zodiac', 'Cataclysm', 'Tidal Wave', 'Abyss of Darkness', 'Firework', 'Edge of Destiny'];
const titles = ['Neon Dreams', 'Crimson Poster', 'Chrome Type', 'Soft Gradient', 'Liquid Metal', 'Paint Study', 'Grunge Collage', 'Orbit', 'Night Drive', 'Glass Render', 'Retro Flyer', 'Monochrome'];
const creators = ['Riot', 'Zylenox', 'Doggie', 'Trick', 'Cyclic', 'Nova', '카이로', '민트', 'Vex', 'Luma', 'Sunix', 'Knobbelboy'];
const tags = ['glow', 'grunge', '3d', 'blender/c4d', 'modern', 'central-texted-composition', 'non-central-texted-composition', 'multi-colored', 'poster-like', 'paint', 'complex'];
// 비지메는 태그가 따로라서 데모용으로 같은 이름을 비지메에도 만들어 둠
for (const t of tags) await ctx.community.addTag(t, null, { id: users[0].id, isAdmin: true }, 'nongd').catch(() => undefined);

function svg(kind: number, [bg, main, light]: string[], text: string, w: number, h: number): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const circles = Array.from({ length: 6 }, (_, i) => {
    const cx = rand() * w;
    const cy = rand() * h;
    const r = 30 + rand() * (w / 4);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${i % 2 ? main : light}" opacity="${0.15 + rand() * 0.35}" filter="url(#blur)"/>`;
  }).join('');
  const stripes = Array.from({ length: 14 }, (_, i) => `<rect x="${i * (w / 14)}" y="0" width="${w / 40}" height="${h}" fill="${light}" opacity="0.08" transform="rotate(12 ${w / 2} ${h / 2})"/>`).join('');
  const center = kind % 2 === 0;
  const tx = center ? w / 2 : w * 0.07;
  const anchor = center ? 'middle' : 'start';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <radialGradient id="rg" cx="${center ? '50%' : '25%'}" cy="55%" r="75%">
        <stop offset="0" stop-color="${main}" stop-opacity="0.85"/>
        <stop offset="1" stop-color="${bg}"/>
      </radialGradient>
      <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${main}"/></linearGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="${18 + rand() * 30}"/></filter>
      <filter id="glow"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="100%" height="100%" fill="${bg}"/>
    <rect width="100%" height="100%" fill="url(#rg)" opacity="${kind % 3 === 0 ? 0.9 : 0.55}"/>
    ${circles}
    ${kind % 4 === 1 ? stripes : ''}
    ${kind % 5 === 2 ? `<polygon points="${w * 0.6},${h * 0.1} ${w * 0.95},${h * 0.5} ${w * 0.6},${h * 0.9} ${w * 0.4},${h * 0.5}" fill="url(#lg)" opacity="0.8"/>` : ''}
    <text x="${tx}" y="${h * 0.56}" text-anchor="${anchor}" font-family="Inter, sans-serif" font-weight="900" font-size="${Math.round(h / 6.5)}" fill="${light}" filter="url(#glow)" letter-spacing="2">${esc.toUpperCase()}</text>
    <text x="${tx}" y="${h * 0.56 + h / 9}" text-anchor="${anchor}" font-family="Inter, sans-serif" font-weight="600" font-size="${Math.round(h / 18)}" fill="${main}" opacity="0.9">GFX REFERENCES</text>
  </svg>`;
}

const total = Number(process.env.DEMO_COUNT ?? 36);
const existing = (await ctx.refs.search({ limit: 1 })).total;
if (existing > 0) {
  console.log(`이미 레퍼런스가 ${existing}개 있어서 데모 데이터를 건너뜁니다.`);
  process.exit(0);
}

const cats: Category[] = ['gm_thumbnail', 'gm_thumbnail', 'gm_thumbnail', 'gm_artwork', 'non_gm'];
const created: number[] = [];
for (let i = 0; i < total; i++) {
  const category = pick(cats);
  const portrait = category !== 'gm_thumbnail' && rand() < 0.35;
  const w = portrait ? 900 : 1280;
  const h = portrait ? 1200 : 720;
  const mapName = category === 'gm_thumbnail' ? pick(maps) : null;
  const title = category === 'gm_thumbnail' ? (rand() < 0.3 ? `${mapName} Showcase` : null) : pick(titles);
  const label = mapName ?? title ?? 'GFX';
  const png = await sharp(Buffer.from(svg(i, pick(palettes), label, w, h))).png().toBuffer();
  const tagSet = new Set<string>();
  const n = 1 + Math.floor(rand() * 3);
  while (tagSet.size < n) tagSet.add(pick(tags));
  const uploader = pick(users);
  const ref = await ctx.refs.create(
    {
      file: { buffer: png, filename: `${label.replace(/\s+/g, '_')}.png`, contentType: 'image/png' },
      category,
      title,
      mapName,
      creatorName: pick(creators),
      tags: [...tagSet],
      uploader,
    },
    { allowDuplicate: true },
  );
  created.push(ref.id);
  process.stdout.write(`\r레퍼런스 생성 중… ${i + 1}/${total}`);
}
console.log();

// 반응 (일부는 지난주 것으로)
const emojis = config.reactionEmojis;
for (const id of created) {
  for (const u of users) {
    if (rand() < 0.45) await ctx.refs.setReaction(id, u, pick(emojis), true);
  }
}
await ctx.db.query("UPDATE reactions SET created_at = now() - (random() * interval '25 days') WHERE random() < 0.5");
await ctx.db.query("UPDATE refs SET created_at = now() - (random() * interval '60 days')");

console.log(`✅ 데모 레퍼런스 ${created.length}개를 만들었습니다. (사용자 ${users.length}명)`);
await ctx.db.close();
