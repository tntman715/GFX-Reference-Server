/**
 * 사람마다 조금씩 다르게 쓴 이름(제작자 / 맵 이름)을 찾아 묶습니다.
 *   "Zylenox" / "zylenox" / "Zylen0x" / "Zy lenox" → 한 묶음
 */

/** 비교용 이름: 대소문자 · 공백 · 기호 · 악센트 차이를 없앰 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s_\-.,'"`~!?·•:;()[\]{}<>/\\|*+=#@&^%$]+/g, '');
}

/** 두 문자열의 편집 거리 (limit 을 넘으면 limit + 1 을 돌려주고 일찍 끝냄) */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const A = [...a];
  const B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= B.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[B.length];
}

/** 이 길이의 이름에서 몇 글자까지 달라도 같은 이름으로 볼지 */
function allowedEdits(len: number): number {
  if (len >= 9) return 2;
  if (len >= 4) return 1;
  return 0;
}

/** 두 이름이 같은 대상을 가리키는 것 같으면 true */
export function looksSame(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const limit = allowedEdits(Math.min([...na].length, [...nb].length));
  return limit > 0 && editDistance(na, nb, limit) <= limit;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface NameGroup {
  /** 가장 많이 쓰인 이름 (통일할 때 기본 추천) */
  suggested: string;
  names: NameCount[];
  total: number;
}

/** 묶음을 구분하는 키 (무시 목록에 저장할 때 사용) */
export function groupKey(names: string[]): string {
  // \u0000 은 jsonb 에 저장할 수 없어서 단위 구분 문자를 씀
  return [...new Set(names)].sort().join('\u001f');
}

/**
 * 비슷한 이름끼리 묶어서 두 가지 이상으로 쓰인 묶음만 돌려줍니다.
 * ignored 에 있는 묶음(관리자가 "서로 다른 이름"이라고 한 것)은 빼고, 많이 쓰인 묶음부터.
 */
export function findSimilarGroups(counts: NameCount[], ignored: Set<string> = new Set()): NameGroup[] {
  const items = counts.filter((c) => c.name.trim());
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (find(i) !== find(j) && looksSame(items[i].name, items[j].name)) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, NameCount[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), items[i]]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1 && !ignored.has(groupKey(g.map((n) => n.name))))
    .map((g) => {
      const names = [...g].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return { suggested: names[0].name, names, total: names.reduce((s, n) => s + n.count, 0) };
    })
    .sort((a, b) => b.total - a.total || a.suggested.localeCompare(b.suggested));
}

/** 입력 중인 이름과 비슷하지만 다르게 쓰인 기존 이름들 (많이 쓰인 순) */
export function similarTo(name: string, counts: NameCount[], limit = 5): NameCount[] {
  if (!name.trim()) return [];
  return counts
    .filter((c) => c.name !== name && looksSame(c.name, name))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
