import {
  type ApplicationCommandOptionBase,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';
import { CATEGORIES, CATEGORY_KEYS, COLOR_FAMILIES, COLOR_FAMILY_KEYS, POPULAR_PERIODS } from '../../constants.js';

/**
 * 슬래시 명령어 정의.
 * 기본 이름은 영어이고, 한국어 디스코드에서는 한국어 이름(/업로드, /검색 …)으로 보입니다.
 */

const categoryChoices = CATEGORY_KEYS.map((k) => ({ name: `${CATEGORIES[k].emoji} ${CATEGORIES[k].label}`, value: k }));
const colorChoices = COLOR_FAMILY_KEYS.map((k) => ({ name: COLOR_FAMILIES[k].label, value: k }));
const periodChoices = Object.entries(POPULAR_PERIODS).map(([k, v]) => ({ name: v.label, value: k }));

function ko<T extends ApplicationCommandOptionBase | SlashCommandSubcommandBuilder>(o: T, name: string, koName: string, desc: string): T {
  o.setName(name).setNameLocalizations({ ko: koName }).setDescription(desc);
  return o;
}

function command(name: string, koName: string, desc: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setNameLocalizations({ ko: koName })
    .setDescription(desc)
    .setContexts(InteractionContextType.Guild);
}

const publicOption = (o: import('discord.js').SlashCommandBooleanOption) =>
  ko(o, 'public', '공개', '채널의 모두에게 결과를 보여줍니다 (기본: 나만 보기)');

export function buildCommands() {
  const upload = command('upload', '업로드', '레퍼런스를 올립니다 (원본은 서버 아카이브에, 미리보기는 데이터베이스에 저장)')
    .addAttachmentOption((o) => ko(o, 'image', '이미지', '올릴 이미지 (PNG / JPG / WEBP / GIF)').setRequired(true))
    .addStringOption((o) =>
      ko(o, 'category', '분류', '레퍼런스 분류')
        .setRequired(true)
        .addChoices(...categoryChoices),
    )
    .addStringOption((o) => ko(o, 'map', '맵이름', '맵 이름 (지메 썸네일은 필수)').setMaxLength(100))
    .addStringOption((o) => ko(o, 'creator', '제작자', '제작자 이름 (비우면 내 이름 · 여러 명이면 쉼표로: A, B)').setMaxLength(300).setAutocomplete(true))
    .addUserOption((o) => ko(o, 'creator_user', '제작자멘션', '(첫) 제작자가 서버 멤버라면 선택하세요'))
    .addStringOption((o) => ko(o, 'tags', '태그', '쉼표로 구분 (예: glow, grunge, 3d)').setMaxLength(300).setAutocomplete(true))
    .addStringOption((o) => ko(o, 'title', '제목', '사진 이름 (비우면 맵 이름 또는 파일 이름)').setMaxLength(100));

  const search = command('search', '검색', '레퍼런스를 검색합니다')
    .addStringOption((o) => ko(o, 'query', '검색어', '제목 / 맵 이름 / 제작자 / 태그 / #번호').setMaxLength(100))
    .addStringOption((o) => ko(o, 'category', '분류', '분류로 거르기').addChoices(...categoryChoices))
    .addStringOption((o) => ko(o, 'tags', '태그', '모두 포함하는 것만 (쉼표로 구분)').setAutocomplete(true))
    .addStringOption((o) => ko(o, 'color', '색상', '이 색이 들어간 것만').addChoices(...colorChoices))
    .addStringOption((o) => ko(o, 'creator', '제작자', '제작자 이름').setAutocomplete(true))
    .addStringOption((o) =>
      ko(o, 'sort', '정렬', '정렬 순서').addChoices(
        { name: '최신순', value: 'newest' },
        { name: '인기순', value: 'popular' },
        { name: '오래된순', value: 'oldest' },
        { name: '무작위', value: 'random' },
      ),
    )
    .addBooleanOption(publicOption);

  const random = command('random', '랜덤', '랜덤 레퍼런스를 보여줍니다')
    .addStringOption((o) => ko(o, 'category', '분류', '분류로 거르기').addChoices(...categoryChoices))
    .addStringOption((o) => ko(o, 'tags', '태그', '모두 포함하는 것만 (쉼표로 구분)').setAutocomplete(true))
    .addStringOption((o) => ko(o, 'color', '색상', '이 색이 들어간 것만').addChoices(...colorChoices))
    .addBooleanOption(publicOption);

  const popular = command('popular', '인기', '반응을 많이 받은 인기 레퍼런스')
    .addStringOption((o) => ko(o, 'period', '기간', '집계 기간 (기본: 이번 주)').addChoices(...periodChoices))
    .addStringOption((o) => ko(o, 'category', '분류', '분류로 거르기').addChoices(...categoryChoices))
    .addBooleanOption(publicOption);

  const color = command('color', '색상', '색상으로 레퍼런스 찾기')
    .addSubcommand((s) =>
      ko(s, 'family', '계열', '빨강/파랑 같은 색 계열로 찾기')
        .addStringOption((o) =>
          ko(o, 'color', '색상', '색 계열')
            .setRequired(true)
            .addChoices(...colorChoices),
        )
        .addStringOption((o) => ko(o, 'category', '분류', '분류로 거르기').addChoices(...categoryChoices))
        .addBooleanOption(publicOption),
    )
    .addSubcommand((s) =>
      ko(s, 'hex', '코드', '색상 코드(#ff0044)와 비슷한 색이 들어간 것 찾기')
        .addStringOption((o) => ko(o, 'code', '코드', '예: #ff0044').setRequired(true).setMaxLength(7))
        .addStringOption((o) => ko(o, 'category', '분류', '분류로 거르기').addChoices(...categoryChoices))
        .addBooleanOption(publicOption),
    )
    .addSubcommand((s) =>
      ko(s, 'similar', '비슷한', '특정 레퍼런스와 색감이 비슷한 것 찾기')
        .addIntegerOption((o) => ko(o, 'id', '번호', '레퍼런스 번호 (#12 → 12)').setRequired(true).setMinValue(1).setAutocomplete(true))
        .addStringOption((o) => ko(o, 'category', '분류', '분류로 거르기').addChoices(...categoryChoices))
        .addBooleanOption(publicOption),
    );

  const view = command('view', '보기', '번호로 레퍼런스 보기')
    .addIntegerOption((o) => ko(o, 'id', '번호', '레퍼런스 번호').setRequired(true).setMinValue(1).setAutocomplete(true))
    .addBooleanOption(publicOption);

  const edit = command('edit', '수정', '내가 올린 레퍼런스 정보 수정 (관리자는 전부)')
    .addIntegerOption((o) => ko(o, 'id', '번호', '레퍼런스 번호').setRequired(true).setMinValue(1).setAutocomplete(true))
    .addStringOption((o) => ko(o, 'title', '제목', '새 제목').setMaxLength(100))
    .addStringOption((o) => ko(o, 'map', '맵이름', '새 맵 이름').setMaxLength(100))
    .addStringOption((o) => ko(o, 'creator', '제작자', '새 제작자 (여러 명이면 쉼표로: A, B)').setMaxLength(300).setAutocomplete(true))
    .addUserOption((o) => ko(o, 'creator_user', '제작자멘션', '(첫) 제작자 (서버 멤버)'))
    .addStringOption((o) => ko(o, 'category', '분류', '새 분류').addChoices(...categoryChoices))
    .addStringOption((o) => ko(o, 'tags', '태그', '태그 전체 교체 (쉼표로 구분, "-" 는 모두 지우기)').setAutocomplete(true))
    .addStringOption((o) => ko(o, 'add_tags', '태그추가', '추가할 태그').setAutocomplete(true))
    .addStringOption((o) => ko(o, 'remove_tags', '태그제거', '뺄 태그').setAutocomplete(true));

  const del = command('delete', '삭제', '내가 올린 레퍼런스 삭제 (관리자는 전부)').addIntegerOption((o) =>
    ko(o, 'id', '번호', '레퍼런스 번호').setRequired(true).setMinValue(1).setAutocomplete(true),
  );

  const leaderboard = command('leaderboard', '랭킹', '레퍼런스 기여 점수 랭킹').addIntegerOption((o) =>
    ko(o, 'page', '페이지', '페이지 번호').setMinValue(1),
  );

  const profile = command('profile', '프로필', '점수와 올린 레퍼런스 보기').addUserOption((o) =>
    ko(o, 'user', '유저', '볼 사람 (비우면 나)'),
  );

  const tags = command('tags', '태그목록', '사용할 수 있는 태그 목록');

  const admin = command('admin', '관리', '관리자 전용 명령어')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      ko(s, 'tag-add', '태그추가', '새 태그 만들기')
        .addStringOption((o) => ko(o, 'name', '이름', '태그 이름 (예: neon)').setRequired(true).setMaxLength(40))
        .addStringOption((o) => ko(o, 'description', '설명', '태그 설명').setMaxLength(100)),
    )
    .addSubcommand((s) =>
      ko(s, 'tag-remove', '태그삭제', '태그 삭제 (달려 있던 레퍼런스에서도 빠짐)').addStringOption((o) =>
        ko(o, 'name', '이름', '태그 이름').setRequired(true).setAutocomplete(true),
      ),
    )
    .addSubcommand((s) =>
      ko(s, 'tag-rename', '태그이름변경', '태그 이름 바꾸기')
        .addStringOption((o) => ko(o, 'from', '기존이름', '기존 태그').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => ko(o, 'to', '새이름', '새 이름').setRequired(true).setMaxLength(40)),
    )
    .addSubcommand((s) =>
      ko(s, 'tag-describe', '태그설명', '태그 설명 바꾸기')
        .addStringOption((o) => ko(o, 'name', '이름', '태그 이름').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => ko(o, 'description', '설명', '새 설명 (비우면 삭제)').setMaxLength(100)),
    )
    .addSubcommand((s) =>
      ko(s, 'score', '점수조정', '점수를 더하거나 뺍니다')
        .addUserOption((o) => ko(o, 'user', '유저', '대상').setRequired(true))
        .addIntegerOption((o) => ko(o, 'amount', '점수', '더할 점수 (빼려면 음수)').setRequired(true).setMinValue(-100000).setMaxValue(100000))
        .addStringOption((o) => ko(o, 'reason', '사유', '사유').setMaxLength(100)),
    )
    .addSubcommand((s) => ko(s, 'highlight', '하이라이트', '주간 인기 레퍼런스를 지금 바로 게시'))
    .addSubcommand((s) => ko(s, 'stats', '통계', '레퍼런스 통계'));

  const link = command('link', '연동', '포토샵 플러그인 / 웹사이트를 내 디스코드 계정과 연동').addStringOption((o) =>
    ko(o, 'code', '코드', '플러그인이나 사이트에 표시된 코드 (예: KQ7M-X3PD)').setRequired(true).setMaxLength(12),
  );

  const help = command('help', '도움말', 'GFX References 봇 사용법');

  return [upload, search, random, popular, color, view, edit, del, leaderboard, profile, tags, admin, link, help];
}

export function commandsJson() {
  return buildCommands().map((c) => c.toJSON());
}
