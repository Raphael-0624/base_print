// Author: DT
/**
 * content/content.js
 */

// ================= 全局配置参数 =================
const CONFIG = {
  // 底部无效区域高度（像素）：滚动条、统计栏等不截取的部分
  BOTTOM_INVALID_PX: 50, 

  // 每次模拟滚动的力度 (deltaY)
  // 注意：飞书 Canvas 内部滚动速度可能受此参数影响
  SCROLL_STEP: 100,

  // 每次截取图片的高度（逻辑像素）
  // 调试指南：
  // 1. 如果图片之间有【重复内容】，请减小此数值 (如 95, 90)
  // 2. 如果图片之间有【内容丢失/缝隙】，请增大此数值
  CROP_HEIGHT: 70, 

  // 滚动后的等待时间 (ms)，防止网速慢导致白屏
  SCROLL_DELAY: 200 
};
// ==============================================

let isCapturing = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_CAPTURE") {
    startProcess();
  }
  if (request.action === "START_ELEMENT_CAPTURE" && request.selector) {
    startElementCapture(request.selector);
  }
});

async function startProcess() {
  if (isCapturing) return;
  
  await showCountdown();
  
  const canvas = findMainCanvas();
  if (!canvas) {
    alert("未找到 Canvas 元素，请确保页面加载完成");
    return;
  }

  isCapturing = true;
  showStatus("截图中...");
  console.log("【飞书打印】开始 Canvas 流程", { cfg: CONFIG });
  console.log("【飞书打印】Canvas 尺寸", { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight });

  try {
    const images = await captureLoop(canvas);
    console.log("【飞书打印】Canvas 流程完成", { count: images.length });
    
    await chrome.storage.local.set({ 'print_images': images });
    chrome.runtime.sendMessage({ action: "OPEN_PREVIEW" });
    
  } catch (e) {
    console.error(e);
    alert("出错: " + e.message);
  } finally {
    isCapturing = false;
    hideStatus();
  }
}

function findMainCanvas() {
  // 找面积最大的 Canvas
  const canvases = Array.from(document.querySelectorAll('canvas'));
  if (canvases.length === 0) return null;
  canvases.sort((a, b) => (b.width * b.height) - (a.width * a.height));
  console.log("【飞书打印】发现 Canvas 数量", { count: canvases.length });
  const chosen = canvases[0];
  console.log("【飞书打印】选择最大 Canvas", { width: chosen.width, height: chosen.height, clientWidth: chosen.clientWidth, clientHeight: chosen.clientHeight });
  return canvases[0];
}

async function captureLoop(canvas) {
  const chunks = [];
  
  // 物理像素比
  const ratio = canvas.width / canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  console.log("【飞书打印】像素比与CSS高度", { ratio, cssHeight });
  
  // 1. 归位
  for(let i=0; i<5; i++) {
    simulateScroll(canvas, -500);
    await wait(100);
  }
  await wait(500);

  let prevFullSnapshot = canvas.toDataURL();
  console.log("【飞书打印】首屏完整快照生成");

  // 2. 首张截图 (高度 - 底部无效区)
  // 这一张通常截大一点，作为表头和第一屏数据
  const firstShotH = (cssHeight - CONFIG.BOTTOM_INVALID_PX) * ratio;
  console.log("【飞书打印】首张截取高度", { firstShotH });
  chunks.push(cropCanvas(canvas, 0, 0, canvas.width, firstShotH));
  console.log("【飞书打印】首张已加入切片", { chunks: chunks.length });

  // 3. 循环滚动
  while (true) {
    simulateScroll(canvas, CONFIG.SCROLL_STEP);
    await wait(CONFIG.SCROLL_DELAY);

    // 到底检测
    const currentFullSnapshot = canvas.toDataURL();
    if (currentFullSnapshot === prevFullSnapshot) {
      console.log("【飞书打印】到底部，停止");
      break;
    }
    prevFullSnapshot = currentFullSnapshot;

    // 计算裁剪区域
    // 我们需要截取 canvas 底部（去掉了无效区）往上数 CROP_HEIGHT 的那一段
    // Y起点 = 总高度 - 底部无效区 - 截取高度
    const startY_CSS = cssHeight - CONFIG.BOTTOM_INVALID_PX - CONFIG.CROP_HEIGHT;
    
    const cropY = startY_CSS * ratio;
    const cropH = CONFIG.CROP_HEIGHT * ratio;
    console.log("【飞书打印】循环截取参数", { startY_CSS, cropY, cropH });
    
    if (cropY < 0) break;

    const chunk = cropCanvas(canvas, 0, cropY, canvas.width, cropH);
    chunks.push(chunk);
    console.log("【飞书打印】切片加入", { chunks: chunks.length });
  }

  return chunks;
}

function simulateScroll(element, deltaY) {
  const event = new WheelEvent('wheel', {
    view: window,
    bubbles: true,
    cancelable: true,
    deltaY: deltaY,
    clientX: element.getBoundingClientRect().left + element.clientWidth / 2,
    clientY: element.getBoundingClientRect().top + element.clientHeight / 2
  });
  console.log("【飞书打印】模拟滚轮", { deltaY, clientX: event.clientX, clientY: event.clientY });
  element.dispatchEvent(event);
}

function cropCanvas(sourceCanvas, x, y, w, h) {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  const ctx = tempCanvas.getContext('2d');
  ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, w, h);
  return tempCanvas.toDataURL('image/png');
}

// UI Helpers
function showCountdown() {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.id = 'fs-print-countdown';
    document.body.appendChild(el);
    let count = 3;
    el.innerText = count;
    const timer = setInterval(() => {
      count--;
      if (count > 0) el.innerText = count;
      else { clearInterval(timer); el.remove(); resolve(); }
    }, 1000);
  });
}

function showStatus(text) {
  let el = document.getElementById('fs-print-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fs-print-status';
    document.body.appendChild(el);
  }
  el.innerText = text;
  el.style.display = 'flex';
}

function hideStatus() {
  const el = document.getElementById('fs-print-status');
  if (el) el.style.display = 'none';
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startElementCapture(selector) {
  const el = document.querySelector(selector);
  if (!el) { alert("未找到元素: " + selector); return; }
  const rect = el.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const loops = 10;
  const chunks = [];
  for (let i = 0; i < loops; i++) {
    const full = await captureViewport();
    const piece = await cropImage(full, rect, ratio);
    chunks.push(piece);
    simulateScroll(el, 100);
    await wait(500);
  }
  const W = Math.round(rect.width * ratio);
  const H = Math.round(rect.height * ratio + loops * 100 * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < chunks.length; i++) {
    const img = new Image();
    img.src = chunks[i];
    await waitForImageLoad(img);
    ctx.drawImage(img, 0, 0, W, Math.round(rect.height * ratio), 0, Math.round(i * 100 * ratio), W, Math.round(rect.height * ratio));
  }
  const result = canvas.toDataURL('image/png');
  await chrome.storage.local.set({ 'print_images': [result] });
  chrome.runtime.sendMessage({ action: 'OPEN_PREVIEW' });
}

function waitForImageLoad(img) {
  return new Promise(resolve => { img.onload = resolve; });
}

function cropImage(dataUrl, rect, ratio) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.round(rect.width * ratio);
      const h = Math.round(rect.height * ratio);
      const x = Math.round(rect.left * ratio);
      const y = Math.round(rect.top * ratio);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      resolve(c.toDataURL('image/png'));
    };
    img.src = dataUrl;
  });
}

function captureViewport() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'CAPTURE_VIEWPORT' }, (res) => {
      if (res && res.dataUrl) resolve(res.dataUrl); else reject(new Error('capture failed'));
    });
  });
}
