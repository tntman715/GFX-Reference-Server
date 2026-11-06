/* GFX References — 단독 플러그인 시작 코드
 *
 * 실제 기능은 gfx-ref/ 폴더에 있고, 여기서는 세 부분을 이어 붙이기만 합니다.
 * 다른 플러그인에 넣는 방법은 gfx-ref/PORTING.md 를 보세요.
 */
(function () {
  var G = (typeof globalThis !== 'undefined' ? globalThis : window).GFXRef;

  // 1. 서버 통신 (연동 정보는 'gfx.' 로 시작하는 이름으로 저장 — 예전 버전과 같아서 다시 연동할 필요 없음)
  var client = G.core.createClient({ storage: G.core.storage.local('gfx.') });

  // 2. 포토샵 기능 (포토샵 밖에서 열면 꺼진 채로 동작)
  var host = G.photoshop.createPhotoshopHost();

  // 3. 화면
  G.panel.mountPanel(document.getElementById('app'), { client: client, host: host });
})();
