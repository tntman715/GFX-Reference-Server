/**
 * 랭킹 티어 (상대평가).
 * 5위 안이면 다이아몬드, 그다음은 전체 랭킹 인원 중 상위 몇 %인지로 정합니다.
 */
export type TierKey = 'diamond' | 'titanium' | 'platinum' | 'gold' | 'silver' | 'bronze';

export interface Tier {
  key: TierKey;
  /** 디스코드 역할 이름 */
  roleName: string;
  label: string;
  labelEn: string;
  emoji: string;
  color: string;
  /** 사람이 읽는 조건 */
  rule: string;
  ruleEn: string;
}

/** 높은 티어부터 */
export const TIERS: Tier[] = [
  { key: 'diamond', roleName: '💎 다이아몬드', label: '다이아몬드', labelEn: 'Diamond', emoji: '💎', color: '#6fe3ff', rule: '5위 안', ruleEn: 'Top 5' },
  { key: 'titanium', roleName: '🔷 티타늄', label: '티타늄', labelEn: 'Titanium', emoji: '🔷', color: '#9fb4c7', rule: '상위 20%', ruleEn: 'Top 20%' },
  { key: 'platinum', roleName: '💠 플래티넘', label: '플래티넘', labelEn: 'Platinum', emoji: '💠', color: '#5fd3bc', rule: '상위 40%', ruleEn: 'Top 40%' },
  { key: 'gold', roleName: '🥇 골드', label: '골드', labelEn: 'Gold', emoji: '🥇', color: '#f5c542', rule: '상위 60%', ruleEn: 'Top 60%' },
  { key: 'silver', roleName: '🥈 실버', label: '실버', labelEn: 'Silver', emoji: '🥈', color: '#c4c4c4', rule: '상위 80%', ruleEn: 'Top 80%' },
  { key: 'bronze', roleName: '🥉 브론즈', label: '브론즈', labelEn: 'Bronze', emoji: '🥉', color: '#cd7f32', rule: '나머지', ruleEn: 'Everyone else' },
];

const BY_KEY = new Map(TIERS.map((t) => [t.key, t]));

export function tierInfo(key: TierKey): Tier {
  return BY_KEY.get(key)!;
}

/** rank: 1부터 (공동 순위 포함), total: 랭킹에 있는 전체 인원 */
export function tierFor(rank: number, total: number): TierKey {
  if (rank <= 5) return 'diamond';
  const pct = rank / Math.max(total, 1);
  if (pct <= 0.2) return 'titanium';
  if (pct <= 0.4) return 'platinum';
  if (pct <= 0.6) return 'gold';
  if (pct <= 0.8) return 'silver';
  return 'bronze';
}
