# 오라클 A1 서버 잡기 봇

오라클 무료 A1(ARM) 서버는 자리가 없어서 만들기가 자주 실패합니다.
이 프로그램은 지금 서버(gfxref)에서 **2분마다 한 번** A1 서버 만들기를 시도합니다.
자리를 잡으면 디스코드 신고 채널(`REPORT_CHANNEL_ID`)로 알리고 (`A1_MENTION_ROLE_ID` 역할 멘션), 그 뒤에는 아무것도 하지 않습니다.

- 필요한 것: Node 18 이상만 있으면 됩니다 (추가 설치 없음).
- 비밀 열쇠: `~/.oci/oci_api_key.pem` (서버 안에만 있음, git 에 넣지 않음).
- 디스코드 토큰과 채널은 `/opt/gfx/server/.env` 에서 읽어서, 따로 복사하지 않습니다.
- 계정은 업그레이드하지 않은 무료 계정 그대로 씁니다. 무료 범위(A1 합계 4 OCPU / 24GB, 디스크 합계 200GB) 안에서만 요청합니다.

## 서버에 설치되어 있는 모양

```
/home/ubuntu/a1-grab/grab.mjs     프로그램
/home/ubuntu/a1-grab/a1.env       오라클 ID 들 (a1.env.example 참고)
/home/ubuntu/a1-grab/state.json   시도 횟수 · 결과 (지우면 처음부터 다시)
/etc/systemd/system/a1-grab.service, a1-grab.timer
```

## 자주 쓰는 명령 (서버에서)

```bash
node ~/a1-grab/grab.mjs check          # 열쇠가 맞는지, 무엇을 요청할지 확인
node ~/a1-grab/grab.mjs check notify   # 디스코드 알림 테스트
journalctl -u a1-grab -n 30            # 최근 시도 기록
sudo systemctl disable --now a1-grab.timer   # 봇 끄기
```

자리를 잡은 뒤에는 `state.json` 에 `finished` 가 생기고 더 시도하지 않습니다.
설정 문제(한도 초과, 잘못된 ID 등)로 멈추면 `stopped` 가 생기고 디스코드로 알려 줍니다.
고친 뒤 `state.json` 을 지우면 다시 시작합니다.
