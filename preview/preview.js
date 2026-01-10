// Author: DT
/**
 * preview/preview.js
 */

const MARGIN_CONFIG = {
  TOP: 50, BOTTOM: 50, LEFT: 50, RIGHT: 50
};
let BOTTOM_CROP = 0;

// 标题样式配置
const TITLE_STYLE = {
  FONT_SIZE: 32,       // 字体大小 px
  PADDING_BOTTOM: 20,  // 标题和图片之间的距离
  COLOR: '#000000',
  FONT: 'bold 32px "Helvetica Neue", Helvetica, Arial, sans-serif'
};

// 全局状态
let GLOBAL_IMAGES = [];
let VISIBLE_COUNT = 0;
let CURRENT_SCALE = 1.0;
let CURRENT_TITLE = ""; // 存储当前标题

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('canvas-wrapper');
  
  // 1. 获取数据
  const data = await chrome.storage.local.get(['print_images','print_loading','print_request']);
  const imagesBase64 = data.print_images || [];
  const loading = data.print_loading;
  
  if (!imagesBase64.length) {
    if (loading && loading.total > 0) {
      container.innerHTML = "<p style='padding:20px; color:#666'>正在加载图片... (0/" + loading.total + ")</p>";
    } else {
      container.innerHTML = "<p style='padding:20px; color:#666'>未加载图片，点击右侧“上传图片”添加</p>";
    }
  }
  
  // 2. 预加载图片
  GLOBAL_IMAGES = await Promise.all(imagesBase64.map(src => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = src;
    });
  }));

  VISIBLE_COUNT = GLOBAL_IMAGES.length;
  CURRENT_SCALE = 1.0;
  
  if (GLOBAL_IMAGES.length) {
    redrawCanvas();
  }

  // 4. 绑定事件
  bindEvents();
  setupOrientationControl();

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.print_images) {
      const newArr = changes.print_images.newValue || [];
      const oldArr = changes.print_images.oldValue || [];
      if (newArr.length > oldArr.length) {
        const added = newArr.slice(oldArr.length);
        console.log('【预览】收到新增图片', { count: added.length });
        const loadedImgs = await Promise.all(added.map(src => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.src = src; })));
        GLOBAL_IMAGES = GLOBAL_IMAGES.concat(loadedImgs);
        VISIBLE_COUNT = GLOBAL_IMAGES.length;
        redrawCanvas();
      }
    }
    if (changes.print_loading) {
      const info = changes.print_loading.newValue;
      if (info && typeof info.loaded === 'number') {
        const containerEl = document.getElementById('canvas-wrapper');
        if (!GLOBAL_IMAGES.length) {
          containerEl.innerHTML = "<p style='padding:20px; color:#666'>正在加载图片... (" + info.loaded + "/" + info.total + ")</p>";
        }
      }
    }
  });

  window.addEventListener('message', async (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'ADD_IMAGES_FROM_POPUP' && Array.isArray(msg.images)) {
      console.log('【预览】接收来自弹窗的图片', { count: msg.images.length });
      const loadedImgs = await Promise.all(msg.images.map(src => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.src = src; })));
      GLOBAL_IMAGES = GLOBAL_IMAGES.concat(loadedImgs);
      VISIBLE_COUNT = GLOBAL_IMAGES.length;
      redrawCanvas();
    }
  });

  // 支持通过扩展消息接收图片（避免使用 storage）
  chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message && message.type === 'ADD_IMAGES_FROM_POPUP' && Array.isArray(message.images)) {
      const loadedImgs = await Promise.all(message.images.map(src => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.src = src; })));
      GLOBAL_IMAGES = GLOBAL_IMAGES.concat(loadedImgs);
      VISIBLE_COUNT = GLOBAL_IMAGES.length;
      redrawCanvas();
      sendResponse({ ok: true, added: loadedImgs.length });
      return true;
    }
  });
});

function openUploadDialog() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    console.log('【预览】选择文件', files.map(f => ({ name: f.name, size: f.size })));
    if (!files.length) { document.body.removeChild(input); return; }
    for (const f of files) {
      try {
        const url = URL.createObjectURL(f);
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => { GLOBAL_IMAGES.push(img); VISIBLE_COUNT = GLOBAL_IMAGES.length; redrawCanvas(); resolve(); };
          img.src = url;
        });
      } catch (e) {
        console.error('【预览】加载失败', { name: f.name, error: e && e.message });
      }
    }
    document.body.removeChild(input);
  }, { once: true });
  input.click();
}

function renderCanvas({ showMask = true, applyCrop = false } = {}) {
  if (VISIBLE_COUNT === 0) return null;

  const visibleImages = GLOBAL_IMAGES.slice(0, VISIBLE_COUNT);
  const deviceRatio = window.devicePixelRatio || 1;
  const desiredContentCssW = Math.floor(window.innerWidth * 0.9); // 浏览器宽度的 90%
  const targetContentW = Math.max(1, Math.floor(desiredContentCssW * deviceRatio)) * CURRENT_SCALE;
  
  // 内容总高度
  const scaledContentH = visibleImages.reduce((sum, img) => {
    const factor = targetContentW / img.width;
    return sum + img.height * factor;
  }, 0);

  // 标题高度
  let titleHeight = 0;
  if (CURRENT_TITLE.trim()) {
    titleHeight = TITLE_STYLE.FONT_SIZE + TITLE_STYLE.PADDING_BOTTOM;
  }

  // 计算有效内容高度
  let effectiveContentH = scaledContentH;
  if (applyCrop && BOTTOM_CROP > 0) {
    effectiveContentH = Math.max(0, scaledContentH - BOTTOM_CROP);
  }

  // Canvas 总高度
  const canvasFinalWidth = Math.round(targetContentW + MARGIN_CONFIG.LEFT + MARGIN_CONFIG.RIGHT);
  const canvasFinalHeight = effectiveContentH + MARGIN_CONFIG.TOP + MARGIN_CONFIG.BOTTOM + titleHeight;

  const canvas = document.createElement('canvas');
  canvas.width = canvasFinalWidth;
  canvas.height = canvasFinalHeight;
  const ctx = canvas.getContext('2d');

  // 背景
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasFinalWidth, canvasFinalHeight);

  // 绘制起始 Y 坐标
  let currentY = MARGIN_CONFIG.TOP;

  // 1. 绘制标题
  if (CURRENT_TITLE.trim()) {
    ctx.font = TITLE_STYLE.FONT;
    ctx.fillStyle = TITLE_STYLE.COLOR;
    ctx.textBaseline = 'top';
    ctx.fillText(CURRENT_TITLE, MARGIN_CONFIG.LEFT, currentY);
    currentY += titleHeight;
  }

  // 2. 绘制图片
  const imgStartY = currentY;
  const drawX = (canvasFinalWidth - targetContentW) / 2;

  // 注意：不再需要 ctx.clip()，因为 canvas.height 已经是裁切后的高度，
  // 绘制超出 Canvas 边界的内容会自动被浏览器忽略，这比手动 clip 更安全且性能更好。

  let tempY = imgStartY;
  visibleImages.forEach(img => {
    const factor = targetContentW / img.width;
    const sW = targetContentW;
    const sH = img.height * factor;
    ctx.drawImage(img, drawX, tempY, sW, sH);
    tempY += sH;
  });

  // ==========================================
  // 3. 绘制辅助线和蒙层 (仅在预览模式 showMask=true 时显示)
  // ==========================================
  if (showMask) {
    // 3.1 底部裁切蒙层
    if (BOTTOM_CROP > 0) {
      const maskY = canvasFinalHeight - BOTTOM_CROP;
      // 红色上边框
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, maskY);
      ctx.lineTo(canvasFinalWidth, maskY);
      ctx.stroke();

      // 半透明蒙层
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, maskY, canvasFinalWidth, BOTTOM_CROP);
    }

    // 3.2 分页预览红线
    // 获取当前排版是否为纵向
    const btnPortrait = document.getElementById('btnPortrait');
    const isPortrait = btnPortrait && btnPortrait.classList.contains('active');
    
    // 使用 CSS 绝对单位换算，确保与浏览器打印一致（1mm ≈ 3.7795px）
    const PAGE_HEIGHT_ADJ = 10; // 分页红线修正值，单位：毫米(mm)
    const mmToPx = 96 / 25.4; // 3.779527559...
    const pageWidthMm = isPortrait ? 210 : 297;
    const pageHeightMm = isPortrait ? 297 : 210;
    const pageWidthPx = pageWidthMm * mmToPx;
    const pageHeightPx = pageHeightMm * mmToPx + PAGE_HEIGHT_ADJ;
    // 将整张 Canvas 等比映射到 A4 宽度，得到每页在 Canvas 坐标中的高度
    const ratio = pageWidthPx / canvasFinalWidth;
    const onePageHeight = pageHeightPx / ratio;

    // 绘制样式
    ctx.save();
    ctx.strokeStyle = '#ff0000'; // 红色
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 8]); // 虚线效果：实线8px，空白8px
    ctx.font = '24px Arial';
    ctx.fillStyle = '#ff0000';
    ctx.textBaseline = 'bottom';

    // 循环绘制分界线，直到超过画布总高度
    let pageLineY = onePageHeight;
    let pageIndex = 1;

    while (pageLineY < canvasFinalHeight) {
      ctx.beginPath();
      ctx.moveTo(0, pageLineY);
      ctx.lineTo(canvasFinalWidth, pageLineY);
      ctx.stroke();

      // 可选：在分界线上方标记页码提示
      ctx.fillText(`--- 第 ${pageIndex} 页结束 ---`, 5, pageLineY - 2);

      pageLineY += onePageHeight;
      pageIndex++;
    }
    ctx.restore();
  }

  return canvas;
}

function redrawCanvas() {
  const container = document.getElementById('canvas-wrapper');
  
  container.innerHTML = ''; 

  if (VISIBLE_COUNT === 0) {
    container.innerHTML = "<p style='padding:20px; color:#666'>已移除所有图片。</p>";
    updateButtonState();
    return;
  }

  const canvas = renderCanvas({ showMask: true, applyCrop: false });
  if (canvas) container.appendChild(canvas);

  updateButtonState();
}

function updateButtonState() {
  const btnRemove = document.getElementById('btnRemoveTail');
  const btnRestore = document.getElementById('btnRestore');
  
  btnRemove.disabled = (VISIBLE_COUNT === 0);
  btnRestore.disabled = (VISIBLE_COUNT === GLOBAL_IMAGES.length);
  btnRestore.innerText = VISIBLE_COUNT < GLOBAL_IMAGES.length 
    ? `恢复 (+${GLOBAL_IMAGES.length - VISIBLE_COUNT})` 
    : "恢复";
}

function bindEvents() {
  const inputTitle = document.getElementById('inputTitle');
  
  inputTitle.addEventListener('input', (e) => {
    CURRENT_TITLE = e.target.value;
    redrawCanvas();
  });

  document.getElementById('inputMarginH').addEventListener('input', (e) => {
    const val = parseInt(e.target.value) || 0;
    MARGIN_CONFIG.LEFT = val;
    MARGIN_CONFIG.RIGHT = val;
    redrawCanvas();
  });
  document.getElementById('inputMarginV').addEventListener('input', (e) => {
    const val = parseInt(e.target.value) || 0;
    MARGIN_CONFIG.TOP = val;
    MARGIN_CONFIG.BOTTOM = val;
    redrawCanvas();
  });
  document.getElementById('inputBottomCrop').addEventListener('input', (e) => {
    BOTTOM_CROP = parseInt(e.target.value) || 0;
    redrawCanvas();
  });
  
  const inputScale = document.getElementById('inputScale');
  inputScale.addEventListener('input', (e) => {
    let pct = parseInt(e.target.value) || 100;
    pct = Math.max(10, Math.min(300, pct));
    e.target.value = pct;
    CURRENT_SCALE = pct / 100;
    redrawCanvas();
  });

  document.getElementById('btnRemoveTail').onclick = () => {
    if (VISIBLE_COUNT > 0) { VISIBLE_COUNT--; redrawCanvas(); }
  };
  document.getElementById('btnRestore').onclick = () => {
    if (VISIBLE_COUNT < GLOBAL_IMAGES.length) { VISIBLE_COUNT++; redrawCanvas(); }
  };

  document.getElementById('btnPrint').onclick = () => window.print();
  
  window.onbeforeprint = () => {
    const container = document.getElementById('canvas-wrapper');
    if (VISIBLE_COUNT > 0) {
      // 打印时 showMask 为 false，因此不会打印出红线和蒙层
      const cleanCanvas = renderCanvas({ showMask: false, applyCrop: true });
      if (cleanCanvas) {
        container.innerHTML = '';
        container.appendChild(cleanCanvas);
      }
    }
  };
  window.onafterprint = () => {
    redrawCanvas();
  };
  
  document.getElementById('btnPdf').onclick = async () => {
    const btn = document.getElementById('btnPdf');
    const cleanCanvas = renderCanvas({ showMask: false, applyCrop: true });
    if (!cleanCanvas) return;
    
    const originalText = btn.innerText;
    btn.innerText = "生成中...";
    btn.disabled = true;
    await new Promise(r => setTimeout(r, 50));
    try {
      await generatePDF(cleanCanvas);
    } catch (e) {
      alert("PDF生成错误: " + e.message);
      console.error(e);
    } finally {
      btn.innerText = originalText;
      btn.disabled = false;
    }
  };

  const btnUpload = document.getElementById('btnUpload');
  if (btnUpload) {
    btnUpload.onclick = () => {
      openUploadDialog();
    };
  }
}

function setupOrientationControl() {
  const style = document.createElement("style");
  document.head.appendChild(style);
  const btnPortrait = document.getElementById('btnPortrait');
  const btnLandscape = document.getElementById('btnLandscape');
  
  const setPage = (type) => {
    // 关键：在这里显式指定 size 和 margin
    // 注意：Chrome有时需要明确写出 mm 单位
    if (type === 'portrait') {
      style.innerHTML = "@page { size: A4 portrait; margin: 0mm; }";
      btnPortrait.classList.add('active');
      btnLandscape.classList.remove('active');
    } else {
      style.innerHTML = "@page { size: A4 landscape; margin: 0mm; }";
      btnLandscape.classList.add('active');
      btnPortrait.classList.remove('active');
    }
    redrawCanvas();
  };
  
  setPage('portrait'); // 初始化
  
  btnPortrait.onclick = () => setPage('portrait');
  btnLandscape.onclick = () => setPage('landscape');
}

async function generatePDF(sourceCanvas) {
  const { jsPDF } = window.jspdf;
  const PDF_MARGIN = 0; 
  const isPortrait = document.getElementById('btnPortrait').classList.contains('active');
  const orientation = isPortrait ? 'p' : 'l';
  
  const pdf = new jsPDF(orientation, 'mm', 'a4');
  const pdfPageWidth = pdf.internal.pageSize.getWidth();
  const pdfPageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pdfPageWidth - (PDF_MARGIN * 2);
  const contentHeight = pdfPageHeight - (PDF_MARGIN * 2);
  
  const canvasWidth = sourceCanvas.width;
  const canvasHeight = sourceCanvas.height;
  
  // 缩放逻辑
  const ratio = contentWidth / canvasWidth; 
  const pageCanvasHeight = contentHeight / ratio;
  
  let leftHeight = canvasHeight;
  let position = 0;
  
  while (leftHeight > 0) {
    const currentSliceHeight = Math.min(leftHeight, pageCanvasHeight);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvasWidth;
    pageCanvas.height = currentSliceHeight;
    const pageCtx = pageCanvas.getContext('2d');
    
    pageCtx.drawImage(sourceCanvas, 0, position, canvasWidth, currentSliceHeight, 0, 0, canvasWidth, currentSliceHeight);
    
    const pageData = pageCanvas.toDataURL('image/jpeg', 0.98);
    pdf.addImage(pageData, 'JPEG', PDF_MARGIN, PDF_MARGIN, contentWidth, currentSliceHeight * ratio);
    
    leftHeight -= currentSliceHeight;
    position += currentSliceHeight;
    
    if (leftHeight > 0) pdf.addPage();
  }
  
  let filename = "飞书表格";
  if (CURRENT_TITLE.trim()) {
    filename = CURRENT_TITLE.trim().replace(/[\\/:*?"<>|]/g, "_");
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  pdf.save(`${filename}_${isPortrait ? '竖版' : '横版'}_${timestamp}.pdf`);
}
