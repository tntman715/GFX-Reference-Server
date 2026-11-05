import { h } from '../dom.js';
import { getLang } from '../i18n.js';

/**
 * 개인정보 안내 (#/privacy).
 * 이 사이트가 무엇을 저장하고 무엇을 저장하지 않는지 짧게 알려 줌.
 */

const KO = {
  title: '개인정보 안내',
  lead: 'GFX References 는 개인 정보를 모으는 사이트가 아니에요. 레퍼런스를 정리하는 데 꼭 필요한 것만 저장하고, 방문 통계는 누구인지 알 수 없는 합계 숫자로만 남겨요.',
  highlight: [
    ['🙈', '누가 무엇을 봤는지는 아무도 볼 수 없어요', '관리자를 포함해 누구도 특정한 사람이 언제 어떤 페이지를 봤는지 알 수 없어요. 그런 기록 자체를 만들지 않아요.'],
    ['🚫', 'IP 주소 · 추적 쿠키를 저장하지 않아요', '광고 · 분석용 쿠키나 외부 추적 도구(구글 애널리틱스 등)를 쓰지 않아요. 그래서 쿠키 동의 창도 없어요.'],
    ['🔢', '방문 통계는 하루 합계 숫자뿐이에요', '예) "11월 6일 · Showcase 페이지 · 42번" 처럼 숫자만 남아요. 이 숫자에서 거꾸로 사람을 찾아낼 수 없어요.'],
  ],
  sections: [
    {
      h: '방문 통계는 이렇게 익명으로 세요',
      items: [
        '하루 동안 같은 사람을 두 번 세지 않으려고, 접속 정보(IP 주소 · 브라우저 종류)를 그날만 쓰는 무작위 값과 섞어 되돌릴 수 없는 값(해시)으로 바꿔요.',
        '이 값은 서버 메모리에만 잠깐 있다가 날짜가 바뀌면 통째로 버려져요. 디스크나 데이터베이스에는 저장되지 않아요.',
        '섞을 때 쓴 무작위 값도 저장하지 않으므로, 나중에 누구였는지 알아낼 방법이 없어요.',
        '저장되는 것: 날짜별 방문자 수 · 페이지별 열람 수 · 휴대폰/PC 비율 · 한국어/영어 비율 · 들어온 곳(Discord · Google 같은 큰 분류만, 주소 전체는 아님).',
        '브라우저에서 "추적 안 함(Do Not Track)" 이나 GPC 를 켜 두셨다면 이 숫자에도 포함되지 않아요.',
      ],
    },
    {
      h: '디스코드로 로그인하면 저장하는 것',
      items: [
        '디스코드 사용자 ID · 이름 · 프로필 사진 주소: 올린 사람 표시, 점수 · 랭킹, 반응, 보드에 필요해요.',
        '로그인 상태를 유지하는 쿠키 하나 (로그인에 꼭 필요한 것으로, 추적용이 아니에요).',
        '이메일, 비밀번호, 디스코드 메시지 내용은 받지도 저장하지도 않아요.',
      ],
    },
    {
      h: '사이트에 공개되는 것',
      items: ['직접 올린 레퍼런스 · 자료 · 쇼케이스 영상, 남긴 반응 수, 점수와 순위는 다른 사람에게도 보여요.'],
    },
    {
      h: '관리자 기록 (감사 로그)',
      items: [
        '관리자가 관리자 권한으로 한 일(태그 정리, 다른 사람 글 수정 · 삭제, 점수 조정, 신고 처리 등)은 누가 언제 했는지 기록으로 남아요.',
        '관리자 권한이 바르게 쓰이는지 확인하기 위한 기록이며, 일반 이용자의 행동은 기록하지 않아요.',
      ],
    },
    {
      h: '지우고 싶을 때',
      items: ['내가 올린 것은 언제든 직접 지울 수 있어요. 계정과 관련된 정보를 모두 지우고 싶다면 GFX References 디스코드 서버의 관리자에게 알려 주세요.'],
    },
  ],
};

const EN = {
  title: 'Privacy',
  lead: 'GFX References is not a site that collects personal data. We keep only what is needed to organise the references, and visit statistics are stored only as anonymous daily totals.',
  highlight: [
    ['🙈', 'Nobody can see who viewed what', 'Not even admins can tell when a particular person visited or which pages they opened. Such records are never created.'],
    ['🚫', 'No IP addresses, no tracking cookies', 'We do not use advertising or analytics cookies or third-party trackers (such as Google Analytics), which is why there is no cookie banner.'],
    ['🔢', 'Visit statistics are daily totals only', 'For example "Nov 6 · Showcase page · 42 views". Nobody can be traced back from these numbers.'],
  ],
  sections: [
    {
      h: 'How visits are counted anonymously',
      items: [
        'To avoid counting the same person twice in one day, the connection details (IP address and browser type) are mixed with a random value used only for that day and turned into a one-way hash.',
        'That hash lives only in the server’s memory and is thrown away when the day changes. It is never written to disk or the database.',
        'The random value is not stored either, so there is no way to find out later who it was.',
        'What is stored: visitors per day, views per page, phone/PC share, Korean/English share, and where visits came from (broad groups such as Discord or Google, never the full address).',
        'If your browser sends “Do Not Track” or GPC, you are not counted at all.',
      ],
    },
    {
      h: 'What is stored when you log in with Discord',
      items: [
        'Your Discord user ID, name and avatar URL: needed to show who uploaded something, for points and rankings, reactions and boards.',
        'One cookie that keeps you logged in (strictly necessary, not for tracking).',
        'We never receive or store your email, password or Discord messages.',
      ],
    },
    {
      h: 'What is public on the site',
      items: ['References, resources and showcase videos you upload, reaction counts, and your points and rank are visible to others.'],
    },
    {
      h: 'Admin records (audit log)',
      items: [
        'When an admin uses admin powers (tidying tags, editing or deleting other people’s posts, adjusting points, handling reports, …) the site records who did it and when.',
        'This exists to check that admin powers are used properly. Regular users’ actions are not logged.',
      ],
    },
    {
      h: 'If you want something removed',
      items: ['You can delete anything you uploaded yourself at any time. To have all data about your account removed, contact an admin on the GFX References Discord server.'],
    },
  ],
};

export function mountPrivacy(root) {
  const c = getLang() === 'en' ? EN : KO;
  document.title = `${c.title} · GFX References`;
  root.append(
    h('div.page-head', h('div', h('h1', c.title), h('p', c.lead))),
    h(
      'div.privacy-highlights',
      c.highlight.map(([icon, title, text]) => h('div.privacy-card', h('div.privacy-icon', { 'aria-hidden': 'true' }, icon), h('strong', title), h('p', text))),
    ),
    h(
      'div.privacy-body',
      c.sections.map((s) => h('section', h('h2', s.h), h('ul', s.items.map((it) => h('li', it))))),
    ),
  );
  return {};
}
