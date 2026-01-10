// Author: DT
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "OPEN_PREVIEW") {
    chrome.tabs.create({ url: 'preview/preview.html' });
  }
  if (request.action === "CAPTURE_VIEWPORT" || request.action === "CAPTURE") {
    chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
      console.log('【后台】CAPTURE_VIEWPORT 调用', { hasData: !!dataUrl });
      sendResponse({ dataUrl });
    });
    return true;
  }
});
