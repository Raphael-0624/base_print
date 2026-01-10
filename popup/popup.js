// Author: DT
document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const pasteBtn = document.getElementById('pasteBtn');
  const pasteTableBtn = document.getElementById('pasteTableBtn');
  const imagesBtn = document.getElementById('imagesBtn');
  const imageInput = document.getElementById('imageInput');

  //原有逻辑：开始截图
  startBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { action: "START_CAPTURE" });
      window.close();
    }
  });

  //新增逻辑：粘贴图片
  pasteBtn.addEventListener('click', async () => {
    try {
      // 1. 请求剪切板读取权限
      // 这里的 navigator.clipboard.read() 需要在用户点击事件中触发
      const clipboardItems = await navigator.clipboard.read();
      
      let foundImage = false;

      for (const item of clipboardItems) {
        // 查找是否有图片类型 (png/jpeg)
        // item.types 是一个数组，如 ["text/plain", "image/png"]
        const imageType = item.types.find(type => type.startsWith('image/'));
        
        if (imageType) {
          foundImage = true;
          const blob = await item.getType(imageType);
          
          // 将 Blob 转为 Base64
          const base64 = await blobToBase64(blob);
          
          // 复用现有的存储结构：print_images 是一个数组
          // 这样预览页的代码不需要任何修改即可兼容
          await chrome.storage.local.set({ 'print_images': [base64] });
          
          // 打开预览页
          chrome.tabs.create({ url: 'preview/preview.html' });
          
          // 关闭 Popup
          // window.close(); // 可选：如果希望立即关闭
          break; // 只处理第一张图片
        }
      }

      if (!foundImage) {
        showToast("未发现复制的图片");
      }

    } catch (err) {
      console.error("读取剪切板失败:", err);
      // 常见错误是没权限或浏览器不支持
      showToast("无法读取剪切板或无图片");
    }
  });

  // 新增逻辑：粘贴多维表格
  if (pasteTableBtn) {
    pasteTableBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'paste_table.html' });
    });
  }

  if (imagesBtn && imageInput) {
    imagesBtn.addEventListener('click', () => {
      imageInput.value = '';
      imageInput.click();
    });

    imageInput.addEventListener('change', async () => {
      const files = Array.from(imageInput.files || []);
      if (!files.length) return;
      try {
        const base64List = await Promise.all(files.map(f => fileToBase64(f)));
        chrome.tabs.create({ url: 'preview/preview.html' }, async () => {
          await new Promise(r => setTimeout(r, 300));
          chrome.runtime.sendMessage({ type: 'ADD_IMAGES_FROM_POPUP', images: base64List });
          window.close();
        });
      } catch (e) {
        console.error('图片读取失败', e);
        showToast('图片读取失败');
      }
    });
  }
});

/**
 * 辅助函数：Blob 转 Base64
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 显示 Toast 提示
 */
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.innerText = msg;
  toast.style.display = 'block';
  
  // 2秒后自动消失
  setTimeout(() => {
    toast.style.display = 'none';
  }, 2000);
}
