// 서비스 워커: 오른쪽 클릭 메뉴, 핀터레스트 '담기' 버튼의 저장 요청, 아이콘 숫자
import { pendingCount, saveToBox } from './lib/box.js';

const MENU_ID = 'gfx-save-image';
const isKo = (chrome.i18n.getUILanguage() || '').toLowerCase().startsWith('ko');

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: isKo ? 'GFX 보관함에 담기' : 'Save to GFX box',
    contexts: ['image'],
  });
  refreshBadge();
});

chrome.runtime.onStartup.addListener(refreshBadge);

async function refreshBadge() {
  try {
    const n = await pendingCount();
    await chrome.action.setBadgeBackgroundColor({ color: '#7b5cff' });
    await chrome.action.setBadgeText({ text: n ? String(n > 999 ? '999+' : n) : '' });
  } catch {
    /* 숫자 표시는 실패해도 괜찮음 */
  }
}

function notifyChanged() {
  refreshBadge();
  chrome.runtime.sendMessage({ type: 'box-changed' }).catch(() => undefined); // 보관함 화면이 닫혀 있으면 받는 곳 없음
}

async function save(data) {
  const res = await saveToBox(data);
  if (res.status === 'saved') notifyChanged();
  return { ok: true, status: res.status, fetched: !!res.item.blob };
}

async function flash(text) {
  await chrome.action.setBadgeText({ text }).catch(() => undefined);
  setTimeout(refreshBadge, 1500);
}

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
  try {
    const res = await save({ imageUrl: info.srcUrl, pageUrl: info.pageUrl, title: '' });
    await flash(res.status === 'exists' ? '=' : '✓');
  } catch {
    await flash('!');
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'save') {
    save(msg).then(reply, (e) => reply({ ok: false, error: String((e && e.message) || e) }));
    return true; // 비동기 답장
  }
  if (msg && msg.type === 'refresh-badge') {
    refreshBadge().then(() => reply({ ok: true }));
    return true;
  }
  return false;
});

// 아이콘을 누르면 보관함 탭을 열거나, 이미 열려 있으면 그 탭으로
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('library.html');
  const [open] = chrome.runtime.getContexts ? await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] }) : [];
  if (open && open.tabId >= 0) {
    await chrome.tabs.update(open.tabId, { active: true });
    if (open.windowId >= 0) await chrome.windows.update(open.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});
