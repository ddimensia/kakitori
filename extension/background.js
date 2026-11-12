// Chrome extension entry point: clicking the toolbar icon opens Kakitori in its own
// app-style window, or brings an already open one to the front.

const APP_URL = chrome.runtime.getURL('index.html');

async function findOpenApp() {
  if (!chrome.runtime.getContexts) return null;
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  return contexts.find((c) => c.documentUrl && c.documentUrl.startsWith(APP_URL)) || null;
}

async function openApp() {
  const open = await findOpenApp();
  if (open && open.tabId >= 0) {
    await chrome.tabs.update(open.tabId, { active: true });
    if (open.windowId >= 0) await chrome.windows.update(open.windowId, { focused: true });
    return;
  }
  await chrome.windows.create({ url: `${APP_URL}#today`, type: 'popup', width: 1200, height: 900 });
}

chrome.action.onClicked.addListener(openApp);

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') openApp();
});
