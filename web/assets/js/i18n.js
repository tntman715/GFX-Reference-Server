/**
 * 한국어 / English 문구.
 * 메뉴, 페이지 제목, 작은 라벨처럼 쉬운 제목은 두 언어 모두 영어로 두고
 * 설명, 버튼, 안내 문구만 바뀝니다. 문구를 고칠 때는 이 파일만 고치면 돼요.
 */

const STORAGE_KEY = 'gfx.lang';

const STRINGS = {
  ko: {
    // 상단 바 · 계정
    'bot.connecting': '연결 중',
    'bot.online': '봇 온라인',
    'bot.offline': '봇 오프라인',
    'bot.onlineTitle': '디스코드 봇이 연결되어 있어요',
    'bot.offlineTitle': '디스코드 봇이 오프라인이에요',
    'banner.offline': '디스코드 봇이 오프라인이라 원본 다운로드가 잠시 멈췄어요. 검색과 미리보기는 그대로 쓸 수 있어요.',
    'account.login': '로그인',
    'account.menu': '계정 메뉴',
    'account.hello': '{name} 님',
    'account.profile': '내 프로필',
    'account.logout': '로그아웃',
    'account.loggedOut': '로그아웃했어요',
    'random.title': '아무 레퍼런스나 하나 보기',
    'lang.label': '언어',
    'grain.title': '화면의 그레인(노이즈) 효과 켜기 / 끄기',
    'start.failed': '서버에 연결할 수 없어요. 잠시 후 새로고침해 주세요.',
    'login.failed': '로그인하지 못했어요.',

    // 공통
    loading: '불러오는 중',
    close: '닫기',
    'error.generic': '오류가 발생했어요.',
    'error.request': '요청 실패 ({status})',
    'error.download': '다운로드 실패 ({status})',
    'grid.error': '불러오지 못했어요.',
    all: '전체',
    copy: '복사',
    copied: '복사했어요',

    // 로그인 창
    'login.reason': '원본 다운로드와 반응은 GFX References 디스코드 서버 멤버만 쓸 수 있어요.',
    'login.oauth': 'Discord 계정으로 로그인',
    'login.or': '또는',
    'login.device': '디스코드 명령어로 로그인',
    'login.unavailable': '지금은 로그인할 수 없어요. 디스코드 봇이 오프라인이에요.',
    'login.typeCommand': '디스코드 서버의 아무 채널에서 이 명령어를 입력하세요.',
    'login.waiting': '승인을 기다리는 중… 10분 안에 입력해 주세요.',
    'login.expired': '코드가 만료되었어요. 다시 시도해 주세요.',
    'login.done': '{name}님, 로그인했어요',

    // 탐색
    'explore.lead': '디스코드 서버에 올라온 썸네일과 작업물 {n}개',
    'explore.search': '제목, 맵 이름, 제작자, 태그, #번호로 검색',
    'explore.searchLabel': '검색',
    'explore.sortLabel': '정렬',
    'sort.newest': '최신순',
    'sort.popular': '인기순',
    'sort.oldest': '오래된순',
    'sort.random': '무작위',
    'explore.onlyCategory': '{label}만 보기',
    'explore.customColor': '직접 선택',
    'explore.customColorTitle': '원하는 색으로 찾기',
    'explore.hexSort': '색상 코드로 찾을 때는 색이 비슷한 순서로 보여줘요',
    'explore.removeFilter': '필터 해제',
    'explore.creator': '제작자 {name}',
    'explore.uploader': '올린 사람 {name}',
    'explore.clearAll': '모두 지우기',
    'explore.searching': '검색 중…',
    'explore.count': '{n}개의 레퍼런스',
    'explore.countOne': '{n}개의 레퍼런스',
    'explore.noMatch': '조건에 맞는 레퍼런스가 없어요.',
    'explore.noRefs': '아직 레퍼런스가 없어요. 디스코드에서 /업로드 명령어로 올릴 수 있어요.',

    // 피드 (영상 목록처럼 보기)
    'feed.lead': '레퍼런스 서버에 등록된 지메 썸네일을 유튜브 화면처럼 모아 봐요. 영상 제목은 맵 이름이에요.',
    'feed.search': '맵 이름, 제작자로 검색',
    'feed.sort.random': '랜덤',
    'feed.sort.popular': '인기순',
    'feed.sort.newest': '최근순',
    'feed.shuffle': '다시 섞기',
    'feed.reactions': '반응 {n}회',
    'feed.empty': '아직 등록된 썸네일이 없어요.',

    // 인기
    'popular.lead': '받은 반응 점수가 높은 순서예요 ({r}). 디스코드 아카이브에 달린 반응도 함께 셉니다.',
    'popular.empty': '이 기간에는 반응을 받은 레퍼런스가 아직 없어요.',

    // 색상
    'colors.lead': '대표 색으로 모아 보거나, 색 코드로 그 색이 들어간 작업물을 찾을 수 있어요.',
    'colors.pick': '색 선택',
    'colors.code': '색상 코드',
    'colors.hint': '색을 고르거나 코드를 입력하고 Enter',
    'colors.search': '찾기',
    'colors.count': '{n}개',
    'colors.choose': '위에서 색을 고르거나 색 코드를 입력해 보세요.',
    'colors.empty': '이 색이 들어간 레퍼런스가 없어요.',

    // 랭킹
    'ranking.rules': '업로드 1개당 +{u}점, 내 레퍼런스가 받은 반응 {r} (내가 단 반응은 빼고 셉니다)',
    'ranking.empty': '아직 랭킹이 없어요.',
    'ranking.points': '{n}점',
    'ranking.detail': '업로드 {u} · 받은 반응 {r}',
    'ranking.prev': '← 이전',
    'ranking.next': '다음 →',

    // 프로필
    'profile.rank': '전체 {r}위',
    'profile.rankShort': '{r}위',
    'profile.empty': '아직 없어요.',

    // 상세
    'detail.react': '반응 남기기',
    'detail.unreact': '반응 취소',
    'detail.loginToReact': '반응을 남기려면 디스코드로 로그인해 주세요.',
    'detail.loginToDownload': '원본은 디스코드로 로그인한 뒤 받을 수 있어요.',
    'detail.loginToDm': 'DM으로 받으려면 디스코드로 로그인해 주세요.',
    'detail.download': '원본 다운로드',
    'detail.downloading': '디스코드에서 가져오는 중…',
    'detail.downloaded': '다운로드: {name}',
    'detail.dm': '디스코드 DM으로 받기',
    'detail.openDiscord': '디스코드에서 원본 보기',
    'detail.openDiscordHint': '아카이브 메시지로 바로 가요. 디스코드 서버 멤버만 열 수 있어요.',
    'detail.hdLoaded': '고화질로 보는 중',
    'detail.dmSent': '디스코드 DM으로 원본을 보냈어요',
    'detail.moreByCreator': '이 제작자의 레퍼런스 보기',
    'detail.unknown': '알 수 없음',
    'detail.noTags': '태그 없음',
    'detail.paletteHint': '누르면 이 색으로 검색, 길게 누르거나 우클릭하면 복사',
    'detail.hexCopied': '{hex} 복사했어요',
    'detail.copyLink': '링크 복사',
    'detail.linkCopied': '링크를 복사했어요',
    'detail.similar': '비슷한 색감',
    'detail.archiveOk': '원본은 GFX References 디스코드 아카이브에서 바로 가져와요.',
    'detail.archiveOff': '디스코드 봇이 오프라인이라 지금은 원본을 받을 수 없어요.',
    'detail.similarEmpty': '색감이 비슷한 레퍼런스가 아직 없어요.',

    // 바닥
    'footer.text': '새 레퍼런스는 위쪽 Upload 버튼이나 디스코드 서버의 /업로드 명령어로 올려요. 올린 작업물은 이곳에 바로 정리돼요.',

    'account.import': '레퍼런스 가져오기',
    'account.tags': '태그 관리 (관리자)',
    'account.reports': '신고 목록 (관리자)',

    'detail.delete': '삭제',
    'detail.deleteConfirm': '#{id} {title} 을(를) 지울까요? 원본 · 미리보기 · 받은 반응이 모두 지워지고 점수도 빠져요. 되돌릴 수 없어요.',
    'detail.deleted': '#{id} 을(를) 지웠어요.',

    'report.button': '신고',
    'report.login': '로그인하면 신고할 수 있어요.',
    'report.title': '신고하기',
    'report.lead': '어떤 문제가 있나요? 관리자에게 바로 알려져요.',
    'report.notePlaceholder': '자세한 내용 (선택, 기타는 필수)',
    'report.pickReason': '신고 이유를 골라 주세요.',
    'report.send': '신고 보내기',
    'report.sent': '신고했어요. 관리자가 확인할게요.',

    'res.search': '이름 · 설명 · 제작자 · 태그로 찾기',
    'res.upload': '{kind} 올리기',
    'res.uploadLead': '파일은 디스코드에 보관돼요. 제작자는 비워도 되고, 올리면 +{n}점을 받아요.',
    'res.lead.asset': '오버레이 · 브러시 · 폰트처럼 작업에 쓰는 에셋이에요. 올리면 +{n}점.',
    'res.lead.plugin': '포토샵 · 애프터이펙트 등에 쓰는 플러그인이에요. 올리면 +{n}점.',
    'res.lead.texturepack': '지오메트리 대시 텍스쳐팩이에요. 올리면 +{n}점.',
    'res.empty': '아직 아무것도 올라오지 않았어요. 첫 번째로 올려 보세요!',
    'res.noMatch': '조건에 맞는 항목이 없어요.',
    'res.sort.newest': '최신순',
    'res.sort.downloads': '다운로드순',
    'res.download': '파일 받기',
    'res.openLink': '다운로드 링크 열기',
    'res.loginToDownload': '로그인하면 파일을 받을 수 있어요.',
    'res.noPreview': '미리보기가 없어요',
    'res.deleteConfirm': '"{title}" 을(를) 지울까요? 파일과 미리보기가 모두 지워지고 점수도 빠져요.',
    'res.deleted': '지웠어요.',
    'res.pickFile': '파일을 끌어다 놓거나 눌러서 고르세요',
    'res.fileHint': '아무 파일이나 (zip, png, psd, abr …) · 최대 {mb}MB · 이미지면 그대로 미리보기가 돼요',
    'res.tooBig': '파일이 너무 커요. 최대 {mb}MB 까지예요. 더 크면 아래 다운로드 링크로 올려 주세요.',
    'res.needFile': '파일을 고르거나 다운로드 링크를 적어 주세요.',
    'res.addImages': '사진 추가',
    'res.removeImage': '사진 빼기',
    'res.imagesHint': '미리보기 사진 최대 6장 (선택)',
    'res.youtubeHint': '소개 영상 유튜브 주소, 여러 개면 줄을 바꿔서 (선택)',
    'res.creatorsHint': '비워도 돼요 · 여러 명이면 쉼표로',
    'res.linkHint': '파일이 {mb}MB 보다 크면 구글 드라이브 등 다운로드 링크를 적어 주세요 (선택)',
    'res.noTags': '아직 태그가 없어요. 관리자가 태그 관리에서 만들 수 있어요.',
    'res.done': '#{id} 로 올렸어요!',
    'upload.button': '레퍼런스 올리기',
    'upload.loginReason': '로그인하면 사이트에서 바로 레퍼런스를 올릴 수 있어요.',
    'upload.membersOnly': 'GFX References 디스코드 서버 멤버만 올릴 수 있어요.',
    'upload.offline': '디스코드 봇이 오프라인이라 지금은 올릴 수 없어요.',
    'upload.lead': '디스코드 /업로드 와 같아요. 올리면 +{n}점을 받아요.',
    'upload.pick': '이미지를 끌어다 놓거나 눌러서 고르세요',
    'upload.change': '다른 이미지로 바꾸려면 누르세요',
    'upload.limit': 'PNG · JPG · WEBP · 최대 {mb}MB',
    'upload.notImage': '이미지 파일만 올릴 수 있어요.',
    'upload.tooBig': '파일이 너무 커요. 최대 {mb}MB 까지 올릴 수 있어요.',
    'upload.needFile': '이미지를 먼저 골라 주세요.',
    'upload.titleHint': '비우면 맵 이름이나 파일 이름',
    'upload.creatorsHint': '비우면 내 이름 ({name})',
    'upload.submit': '올리기',
    'upload.sending': '올리는 중…',
    'upload.done': '#{id} 로 올렸어요!',
    'upload.duplicate': '⚠️ 비슷한 레퍼런스가 이미 있어요. 같은 작품이 아닌지 확인해 주세요.',
    'upload.anyway': '그래도 올리기',
    'footer.random': '랜덤으로 하나 보기',
    'footer.note': '원본 파일은 디스코드 서버에 보관되며, 디스코드로 로그인하면 받을 수 있어요.',

    // 계정 메뉴 추가
    'account.boards': '내 보드',
    'account.edits': '수정 제안',

    // 보드
    'board.save': '보드에 저장',
    'board.loginToSave': '로그인하면 마음에 드는 썸네일을 보드에 모을 수 있어요.',
    'board.pickerHint': '넣을 보드를 고르세요. 다시 누르면 빠져요.',
    'board.newPlaceholder': '새 보드 이름 (예: 글로우 모음)',
    'board.create': '만들기',
    'board.none': '아직 보드가 없어요. 이름을 적어 첫 보드를 만들어 보세요.',
    'board.added': '"{name}" 에 넣었어요',
    'board.removed': '"{name}" 에서 뺐어요',
    'board.created': '"{name}" 보드를 만들었어요',
    'board.count': '{n}개',
    'board.empty': '이 보드는 비어 있어요. 탐색이나 피드에서 썸네일의 저장 버튼을 눌러 모아 보세요.',
    'board.mineEmpty': '아직 보드가 없어요. 위에서 이름을 적어 만들거나, 썸네일의 저장 버튼을 눌러 보세요.',
    'board.rename': '이름 바꾸기',
    'board.renamePrompt': '새 보드 이름',
    'board.delete': '보드 지우기',
    'board.deleteConfirm': '"{name}" 보드를 지울까요? 보드 안의 레퍼런스 자체는 지워지지 않아요.',
    'board.deleted': '보드를 지웠어요',
    'board.by': '{name} 님의 보드',
    'board.loginToSee': '로그인하면 내 보드를 볼 수 있어요.',
    'board.intro': '탐색이나 피드에서 썸네일의 저장 버튼을 누르면 원하는 보드에 모을 수 있어요. 보드는 다른 사람도 볼 수 있어요.',

    // 수정 / 수정 제안
    'edit.edit': '수정',
    'edit.propose': '수정 제안',
    'edit.loginToEdit': '로그인하면 태그나 제작자를 고치거나 수정을 제안할 수 있어요.',
    'edit.titleEdit': '레퍼런스 수정',
    'edit.titlePropose': '수정 제안하기',
    'edit.editHint': '바로 저장돼요.',
    'edit.proposeHint': '올린 사람이 받아들이면 바뀌어요. 받아들여지면 +{n}점(업로드 점수의 절반)을 받아요.',
    'edit.creatorsHint': '여러 명이 함께 만들었으면 쉼표로 구분해요 (예: A, B)',
    'edit.notePlaceholder': '올린 사람에게 남길 말 (선택)',
    'edit.save': '저장',
    'edit.send': '제안 보내기',
    'edit.cancel': '취소',
    'edit.saved': '수정했어요',
    'edit.sent': '수정 제안을 보냈어요. 올린 사람이 받아들이면 바뀌어요.',
    'edit.accept': '받아들이기',
    'edit.reject': '거절',
    'edit.withdraw': '제안 취소',
    'edit.accepted': '받아들였어요. 제안한 사람이 점수를 받았어요.',
    'edit.rejected': '거절했어요',
    'edit.withdrawn': '제안을 취소했어요',
    'edit.rejectReason': '거절하는 이유를 적어 주세요 (선택, 제안한 사람에게 DM 으로 전해져요)',
    'edit.by': '{name} 님의 제안',
    'edit.mine': '내가 보낸 제안이 확인을 기다리고 있어요',
    'edit.receivedTab': '받은 제안',
    'edit.sentTab': '보낸 제안',
    'edit.all': '모든 레퍼런스 보기 (관리자)',
    'edit.noneReceived': '확인할 수정 제안이 없어요.',
    'edit.noneSent': '아직 보낸 제안이 없어요. 레퍼런스 상세 화면의 "수정 제안" 버튼으로 보낼 수 있어요.',
    'edit.status.pending': '확인 대기',
    'edit.status.accepted': '받아들여짐',
    'edit.status.rejected': '반영 안 됨',
    'edit.status.cancelled': '취소됨',
    'edit.deletedRef': '지워진 레퍼런스',
    'edit.loginToSee': '로그인하면 수정 제안을 볼 수 있어요.',
    'edit.intro': '내가 올린 레퍼런스에 다른 사람이 보낸 수정 제안이에요. 받아들이면 바로 바뀌고, 제안한 사람은 +{n}점을 받아요.',
    'edit.none': '(없음)',
    'ranking.edits': '받아들여진 수정 제안 1개당 +{e}점',
    'ranking.tiers': '티어 (상대평가)',
    'ranking.more': '제작과정 영상 +{v} · 에셋 +{a} · 플러그인 +{p} · 텍스쳐팩 +{x}',
    'video.lead': '제작과정 영상 · 붙이면 +{n}점',
    'video.addedBy': '붙인 사람',
    'video.placeholder': '제작과정(스피드아트) 유튜브 주소',
    'video.add': '영상 붙이기 +{n}',
    'video.added': '제작과정 영상을 붙였어요! +{n}점',
    'video.login': '로그인하면 제작과정 영상을 붙일 수 있어요.',
    'video.remove': '영상 빼기',
    'video.removeConfirm': '이 영상을 뺄까요? 붙인 사람의 점수도 빠져요.',
    'video.removed': '영상을 뺐어요.',
    'video.none': '아직 제작과정 영상이 없어요.',
  },

  en: {
    'bot.connecting': 'Connecting',
    'bot.online': 'Bot online',
    'bot.offline': 'Bot offline',
    'bot.onlineTitle': 'The Discord bot is connected',
    'bot.offlineTitle': 'The Discord bot is offline',
    'banner.offline': 'The Discord bot is offline, so downloads are paused. Search and previews still work.',
    'account.login': 'Log in',
    'account.menu': 'Account menu',
    'account.hello': '{name}',
    'account.profile': 'My profile',
    'account.logout': 'Log out',
    'account.loggedOut': 'Logged out',
    'random.title': 'Open a random reference',
    'lang.label': 'Language',
    'grain.title': 'Turn the grain (noise) effect on or off',
    'start.failed': "Can't reach the server. Try refreshing in a moment.",
    'login.failed': 'Login failed.',

    loading: 'Loading',
    close: 'Close',
    'error.generic': 'Something went wrong.',
    'error.request': 'Request failed ({status})',
    'error.download': 'Download failed ({status})',
    'grid.error': "Couldn't load this.",
    all: 'All',
    copy: 'Copy',
    copied: 'Copied',

    'login.reason': 'Downloading originals and reacting are for members of the GFX References Discord server.',
    'login.oauth': 'Continue with Discord',
    'login.or': 'or',
    'login.device': 'Log in with a Discord command',
    'login.unavailable': 'Login is unavailable while the Discord bot is offline.',
    'login.typeCommand': 'Type this command in any channel on the Discord server.',
    'login.waiting': 'Waiting for approval… Enter it within 10 minutes.',
    'login.expired': 'The code expired. Please try again.',
    'login.done': 'Logged in as {name}',

    'explore.lead': '{n} thumbnails, PFPs and banners from our Discord server',
    'explore.search': 'Search titles, maps, creators, tags or #number',
    'explore.searchLabel': 'Search',
    'explore.sortLabel': 'Sort',
    'sort.newest': 'Newest',
    'sort.popular': 'Popular',
    'sort.oldest': 'Oldest',
    'sort.random': 'Random',
    'explore.onlyCategory': 'Show {label} only',
    'explore.customColor': 'Custom',
    'explore.customColorTitle': 'Search by a custom color',
    'explore.hexSort': 'Results are sorted by color similarity when searching by color code',
    'explore.removeFilter': 'Remove filter',
    'explore.creator': 'Creator: {name}',
    'explore.uploader': 'Uploader: {name}',
    'explore.clearAll': 'Clear all',
    'explore.searching': 'Searching…',
    'explore.count': '{n} references',
    'explore.countOne': '{n} reference',
    'explore.noMatch': 'No references match these filters.',
    'explore.noRefs': 'No references yet. They can be uploaded on Discord with /업로드.',

    'feed.lead': 'GD thumbnails from the archive, laid out like a YouTube feed. Video titles are the map names.',
    'feed.search': 'Search map names or creators',
    'feed.sort.random': 'Random',
    'feed.sort.popular': 'Popular',
    'feed.sort.newest': 'Newest',
    'feed.shuffle': 'Shuffle',
    'feed.reactions': '{n} reactions',
    'feed.empty': 'No thumbnails yet.',

    'popular.lead': 'Ranked by reaction points ({r}), including reactions on the Discord archive.',
    'popular.empty': 'Nothing has received reactions in this period yet.',

    'colors.lead': 'Browse by main color, or search with a color code.',
    'colors.pick': 'Pick a color',
    'colors.code': 'Color code',
    'colors.hint': 'Pick a color or type a code and press Enter',
    'colors.search': 'Search',
    'colors.count': '{n}',
    'colors.choose': 'Pick a color above or enter a color code.',
    'colors.empty': 'No references with this color.',

    'ranking.rules': '+{u} per upload, reactions received {r} (your own reactions are not counted)',
    'ranking.empty': 'No rankings yet.',
    'ranking.points': '{n} pts',
    'ranking.detail': 'Uploads {u} · Reactions {r}',
    'ranking.prev': '← Prev',
    'ranking.next': 'Next →',

    'profile.rank': 'Rank #{r}',
    'profile.rankShort': '#{r}',
    'profile.empty': 'Nothing yet.',

    'detail.react': 'React',
    'detail.unreact': 'Remove reaction',
    'detail.loginToReact': 'Log in with Discord to react.',
    'detail.loginToDownload': 'Log in with Discord to download originals.',
    'detail.loginToDm': 'Log in with Discord to get it in your DMs.',
    'detail.download': 'Download original',
    'detail.downloading': 'Fetching from Discord…',
    'detail.downloaded': 'Downloaded {name}',
    'detail.dm': 'Send to my Discord DMs',
    'detail.openDiscord': 'View original on Discord',
    'detail.openDiscordHint': 'Jumps to the archive message. Only members of the Discord server can open it.',
    'detail.hdLoaded': 'Showing high quality',
    'detail.dmSent': 'Sent to your Discord DMs',
    'detail.moreByCreator': 'More by this creator',
    'detail.unknown': 'Unknown',
    'detail.noTags': 'No tags',
    'detail.paletteHint': 'Click to search this color, long-press or right-click to copy',
    'detail.hexCopied': 'Copied {hex}',
    'detail.copyLink': 'Copy link',
    'detail.linkCopied': 'Link copied',
    'detail.similar': 'Similar colors',
    'detail.archiveOk': 'Originals come straight from the GFX References Discord archive.',
    'detail.archiveOff': 'The Discord bot is offline, so originals are unavailable right now.',
    'detail.similarEmpty': 'No references with a similar palette yet.',

    'footer.text': 'New references are uploaded with the Upload button above or the /업로드 command on our Discord server, and show up here right away.',

    'account.import': 'Import references',
    'account.tags': 'Manage tags (admin)',
    'account.reports': 'Reports (admin)',

    'detail.delete': 'Delete',
    'detail.deleteConfirm': 'Delete #{id} {title}? The original, preview and reactions are removed and the points go away. This cannot be undone.',
    'detail.deleted': 'Deleted #{id}.',

    'report.button': 'Report',
    'report.login': 'Log in to report.',
    'report.title': 'Report',
    'report.lead': 'What is wrong? Admins are notified right away.',
    'report.notePlaceholder': 'Details (optional, required for Other)',
    'report.pickReason': 'Pick a reason.',
    'report.send': 'Send report',
    'report.sent': 'Report sent. An admin will take a look.',

    'res.search': 'Search names, descriptions, creators or tags',
    'res.upload': 'Upload {kind}',
    'res.uploadLead': 'Files are kept on Discord. Creator is optional. You get +{n} points.',
    'res.lead.asset': 'Overlays, brushes, fonts and other assets for your work. +{n} points per upload.',
    'res.lead.plugin': 'Plugins for Photoshop, After Effects and more. +{n} points per upload.',
    'res.lead.texturepack': 'Geometry Dash texture packs. +{n} points per upload.',
    'res.empty': 'No {kind} yet. Be the first to upload one!',
    'res.noMatch': 'Nothing matches.',
    'res.sort.newest': 'Newest',
    'res.sort.downloads': 'Most downloaded',
    'res.download': 'Download',
    'res.openLink': 'Open download link',
    'res.loginToDownload': 'Log in to download files.',
    'res.noPreview': 'No preview',
    'res.deleteConfirm': 'Delete "{title}"? The file and previews are removed and the points go away.',
    'res.deleted': 'Deleted.',
    'res.pickFile': 'Drop a file here or click to choose',
    'res.fileHint': 'Any file (zip, png, psd, abr …) · up to {mb}MB · images become the preview',
    'res.tooBig': 'That file is too big. The limit is {mb}MB; use a download link below instead.',
    'res.needFile': 'Pick a file or enter a download link.',
    'res.addImages': 'Add images',
    'res.removeImage': 'Remove image',
    'res.imagesHint': 'Up to 6 preview images (optional)',
    'res.youtubeHint': 'YouTube links, one per line (optional)',
    'res.creatorsHint': 'Optional · separate several with commas',
    'res.linkHint': 'If the file is over {mb}MB, add a download link such as Google Drive (optional)',
    'res.noTags': 'No tags yet. Admins can add some in Manage tags.',
    'res.done': 'Uploaded as #{id}!',
    'upload.button': 'Upload a reference',
    'upload.loginReason': 'Log in to upload references right from the site.',
    'upload.membersOnly': 'Only members of the GFX References Discord server can upload.',
    'upload.offline': 'The Discord bot is offline, so uploads are paused.',
    'upload.lead': 'Same as /업로드 on Discord. You get +{n} points.',
    'upload.pick': 'Drop an image here or click to choose',
    'upload.change': 'Click to pick a different image',
    'upload.limit': 'PNG · JPG · WEBP · up to {mb}MB',
    'upload.notImage': 'Only image files can be uploaded.',
    'upload.tooBig': 'That file is too big. The limit is {mb}MB.',
    'upload.needFile': 'Pick an image first.',
    'upload.titleHint': 'Leave empty to use the map or file name',
    'upload.creatorsHint': 'Leave empty to use your name ({name})',
    'upload.submit': 'Upload',
    'upload.sending': 'Uploading…',
    'upload.done': 'Uploaded as #{id}!',
    'upload.duplicate': '⚠️ A similar reference already exists. Please check it is not the same work.',
    'upload.anyway': 'Upload anyway',
    'footer.random': 'Open a random one',
    'footer.note': 'Original files are kept on the Discord server and can be downloaded after logging in with Discord.',

    'account.boards': 'My boards',
    'account.edits': 'Suggested edits',

    'board.save': 'Save to board',
    'board.loginToSave': 'Log in to collect thumbnails on your boards.',
    'board.pickerHint': 'Pick a board. Click again to take it out.',
    'board.newPlaceholder': 'New board name (e.g. Glow picks)',
    'board.create': 'Create',
    'board.none': 'No boards yet. Type a name to make your first one.',
    'board.added': 'Saved to "{name}"',
    'board.removed': 'Removed from "{name}"',
    'board.created': 'Created "{name}"',
    'board.count': '{n} items',
    'board.empty': 'This board is empty. Use the save button on thumbnails in Explore or Feed to collect some.',
    'board.mineEmpty': 'No boards yet. Name one above, or use the save button on any thumbnail.',
    'board.rename': 'Rename',
    'board.renamePrompt': 'New board name',
    'board.delete': 'Delete board',
    'board.deleteConfirm': 'Delete the board "{name}"? The references themselves stay.',
    'board.deleted': 'Board deleted',
    'board.by': "{name}'s board",
    'board.loginToSee': 'Log in to see your boards.',
    'board.intro': 'Use the save button on thumbnails in Explore or Feed to collect them on your boards. Boards are visible to everyone.',

    'edit.edit': 'Edit',
    'edit.propose': 'Suggest edit',
    'edit.loginToEdit': 'Log in to fix tags or creators, or to suggest an edit.',
    'edit.titleEdit': 'Edit reference',
    'edit.titlePropose': 'Suggest an edit',
    'edit.editHint': 'Changes are saved right away.',
    'edit.proposeHint': 'The uploader reviews your suggestion. If accepted, you get +{n} points (half an upload).',
    'edit.creatorsHint': 'Separate several creators with commas (e.g. A, B)',
    'edit.notePlaceholder': 'Note for the uploader (optional)',
    'edit.save': 'Save',
    'edit.send': 'Send suggestion',
    'edit.cancel': 'Cancel',
    'edit.saved': 'Saved',
    'edit.sent': 'Suggestion sent. It changes once the uploader accepts it.',
    'edit.accept': 'Accept',
    'edit.reject': 'Decline',
    'edit.withdraw': 'Withdraw',
    'edit.accepted': 'Accepted. The suggester got points.',
    'edit.rejected': 'Declined',
    'edit.withdrawn': 'Suggestion withdrawn',
    'edit.rejectReason': 'Why are you declining? (optional, sent to the suggester by DM)',
    'edit.by': 'Suggested by {name}',
    'edit.mine': 'Your suggestion is waiting for review',
    'edit.receivedTab': 'Received',
    'edit.sentTab': 'Sent',
    'edit.all': 'All references (admin)',
    'edit.noneReceived': 'No suggestions to review.',
    'edit.noneSent': 'You have not sent any suggestions. Use "Suggest edit" on a reference to send one.',
    'edit.status.pending': 'Pending',
    'edit.status.accepted': 'Accepted',
    'edit.status.rejected': 'Declined',
    'edit.status.cancelled': 'Withdrawn',
    'edit.deletedRef': 'Deleted reference',
    'edit.loginToSee': 'Log in to see suggested edits.',
    'edit.intro': 'Edits other people suggested for references you uploaded. Accepting applies them right away and gives the suggester +{n} points.',
    'edit.none': '(none)',
    'ranking.edits': '+{e} per accepted edit suggestion',
    'ranking.tiers': 'Tiers (relative)',
    'ranking.more': 'Speedart video +{v} · Asset +{a} · Plugin +{p} · Texture pack +{x}',
    'video.lead': 'Making-of videos · +{n} points for adding one',
    'video.addedBy': 'Added by',
    'video.placeholder': 'YouTube link to a making-of (speedart) video',
    'video.add': 'Add video +{n}',
    'video.added': 'Video added! +{n} points',
    'video.login': 'Log in to add making-of videos.',
    'video.remove': 'Remove video',
    'video.removeConfirm': 'Remove this video? The points of whoever added it go away too.',
    'video.removed': 'Video removed.',
    'video.none': 'No making-of videos yet.',
  },
};

// 서버가 한국어로 보내 주는 이름들의 영어 표기 (key 기준)
const EN_CATEGORIES = {
  gm_thumbnail: { label: 'GD Thumbnail', shortLabel: 'Thumbnail' },
  gm_artwork: { label: 'GD PFP, Banner etc.', shortLabel: 'PFP, Banner etc.' },
  non_gm: { label: 'Non-GD', shortLabel: 'Non-GD' },
};
const EN_PERIODS = { week: 'This week', month: 'This month', year: 'This year', all: 'All time' };

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
  return langs.some((l) => /^ko\b/i.test(l)) ? 'ko' : 'en';
}

let current = detect();
const listeners = new Set();
document.documentElement.lang = current;

export function getLang() {
  return current;
}

export function setLang(lang) {
  if (lang === current || !STRINGS[lang]) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  document.documentElement.lang = lang;
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** t('explore.count', { n: 12 }) → "12개의 레퍼런스" */
export function t(key, vars) {
  const s = STRINGS[current][key] ?? STRINGS.ko[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
}

export function locale() {
  return current === 'ko' ? 'ko-KR' : 'en-US';
}

/** 분류 이름. c 는 meta.categories 의 항목 또는 { key, label } */
export function categoryLabel(c, short = false) {
  if (!c) return '';
  const en = current === 'en' ? EN_CATEGORIES[c.key] : null;
  if (en) return short ? en.shortLabel : en.label;
  return short ? (c.shortLabel ?? c.label) : c.label;
}

export function colorLabel(c) {
  if (!c) return '';
  return current === 'en' ? colorNameEn(c.key) : c.label;
}

/** 색 계열 key 의 영어 이름 (제목은 두 언어 모두 영어) */
export function colorNameEn(key) {
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : '';
}

export function periodLabel(p) {
  if (!p) return '';
  return current === 'en' ? (EN_PERIODS[p.key] ?? p.label) : p.label;
}

/** index.html 의 data-i18n 요소 글자를 현재 언어로 */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
}
