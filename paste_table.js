// --- 核心状态 ---
let globalSchema = null;
let globalRows = []; 
let columnStates = [];
let activeGroupFields = []; 
let parentRelationColIndex = -1; 

// DOM
const tableContent = document.getElementById('table-content');
const emptyMask = document.getElementById('empty-mask');
const popover = document.getElementById('col-popover');
const widthInput = document.getElementById('col-width-input');
const deleteBtn = document.getElementById('btn-delete-col');
const toolbar = document.getElementById('toolbar');
const activeGroupsContainer = document.getElementById('active-groups');
const addGroupSelect = document.getElementById('add-group-select');
const parentColSelect = document.getElementById('parent-col-select');
let activeColIndex = -1;

// Listeners
document.addEventListener('click', (e) => {
    if (!e.target.closest('th') && !e.target.closest('.popover')) hidePopover();
});
document.addEventListener('paste', handlePaste);

document.getElementById('btn-save-img').addEventListener('click', async () => {
    const table = tableContent.querySelector('table');
    if (!table) return alert('请先粘贴数据');
    
    const btn = document.getElementById('btn-save-img');
    const originalText = btn.innerText;
    btn.innerText = '生成中...'; btn.disabled = true;

    try {
        table.classList.add('capturing');
        const canvas = await html2canvas(table, {
            backgroundColor: '#ffffff', scale: 2,
            width: table.scrollWidth, height: table.scrollHeight,
            windowWidth: table.scrollWidth, windowHeight: table.scrollHeight,
            onclone: (doc) => doc.querySelector('table').style.overflow = 'visible'
        });
        const link = document.createElement('a');
        link.download = `Table_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (err) { console.error(err); alert('截图失败'); } 
    finally {
        table.classList.remove('capturing');
        btn.innerText = originalText; btn.disabled = false;
    }
});

// 新增：打印功能
document.getElementById('btn-print').addEventListener('click', async () => {
    const table = tableContent.querySelector('table');
    if (!table) return alert('请先粘贴数据');
    
    const btn = document.getElementById('btn-print');
    const originalText = btn.innerText;
    btn.innerText = '生成中...'; btn.disabled = true;

    try {
        table.classList.add('capturing');
        const canvas = await html2canvas(table, {
            backgroundColor: '#ffffff', scale: 2,
            width: table.scrollWidth, height: table.scrollHeight,
            windowWidth: table.scrollWidth, windowHeight: table.scrollHeight,
            onclone: (doc) => doc.querySelector('table').style.overflow = 'visible'
        });
        
        const base64 = canvas.toDataURL('image/png');
        
        // 存储图片并打开预览页
        await chrome.storage.local.set({ 'print_images': [base64] });
        chrome.tabs.create({ url: 'preview/preview.html' });

    } catch (err) { console.error(err); alert('生成失败'); } 
    finally {
        table.classList.remove('capturing');
        btn.innerText = originalText; btn.disabled = false;
    }
});

function handlePaste(e) {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    if (html) processHTML(html);
}

function processHTML(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const bitableTable = doc.querySelector('.byte-bitable');
    
    if (!bitableTable) return alert('无法识别数据格式');

    try {
        if (bitableTable.dataset.byteBitable) {
            globalSchema = JSON.parse(bitableTable.dataset.byteBitable);
        }
    } catch (err) { console.error(err); }

    if (!globalSchema || !globalSchema.header) return;

    globalRows = Array.from(bitableTable.querySelectorAll('tr'));
    columnStates = globalSchema.header.map((col, index) => ({ index, width: null, deleted: false }));
    calculateInitWidths();
    activeGroupFields = [];
    parentRelationColIndex = -1;

    initToolbar();
    renderTable();
}

function getTextWidth(text, font) {
    const canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    context.font = font;
    return context.measureText(text).width;
}

function calculateInitWidths() {
    if (!globalSchema || !globalSchema.header) return;
    
    // 字体配置，需与 CSS 保持一致
    const fontHeader = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    const fontCell = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    const PADDING = 12; // 左右 padding (4+4) + 微调余量

    globalSchema.header.forEach((col, index) => {
        // 1. 计算表头宽度
        let maxW = getTextWidth(col.name, fontHeader) + PADDING + 20; // +20 for resizer/icon
        
        // 2. 全量采样计算所有行内容的宽度
        globalRows.forEach(tr => {
            const tds = tr.querySelectorAll('td');
            if (index < tds.length) {
                const text = extractText(tds[index]);
                // 如果是多行文本，取最长的一行
                const lines = text.split('\n');
                lines.forEach(line => {
                    const w = getTextWidth(line.trim(), fontCell) + PADDING;
                    if (w > maxW) maxW = w;
                });
            }
        });

        // 3. 应用限制规则：自适应但初始最大 240，最小 10
        let finalW = Math.ceil(maxW);
        if (finalW > 240) finalW = 240;
        if (finalW < 10) finalW = 10;

        columnStates[index].width = finalW;
    });
}

function initToolbar() {
    toolbar.style.display = 'flex';
    renderGroupPills();
    updateToolbarSelects();

    addGroupSelect.onchange = (e) => {
        const colIndex = parseInt(e.target.value);
        if (!isNaN(colIndex) && activeGroupFields.length < 3) {
            activeGroupFields.push(colIndex);
            renderGroupPills();
            renderTable();
        }
        updateToolbarSelects();
        e.target.value = "";
    };

    parentColSelect.onchange = (e) => {
        parentRelationColIndex = parseInt(e.target.value);
        renderTable(); // 不再重置分组，允许并存
    };
}

function updateToolbarSelects() {
    addGroupSelect.innerHTML = '<option value="" disabled selected>选择分组字段</option>';
    globalSchema.header.forEach((col, index) => {
        if (activeGroupFields.includes(index)) return;
        if ([1, 3, 4, 11].includes(col.type)) {
            const option = document.createElement('option');
            option.value = index; option.textContent = col.name;
            addGroupSelect.appendChild(option);
        }
    });
    addGroupSelect.disabled = activeGroupFields.length >= 3;

    // 保持父列选中状态
    const currentParentVal = parentColSelect.value;
    parentColSelect.innerHTML = '<option value="-1">选择父记录字段</option>';
    globalSchema.header.forEach((col, index) => {
        if (index === 0) return; // 首列不能是父指针
        const opt = document.createElement('option');
        opt.value = index; opt.textContent = col.name;
        parentColSelect.appendChild(opt);
    });
    // 尝试恢复选中，如果之前选中的列还在的话
    if(currentParentVal) parentColSelect.value = parentRelationColIndex;
}

function renderGroupPills() {
    activeGroupsContainer.innerHTML = '';
    activeGroupFields.forEach((colIndex, i) => {
        const colName = globalSchema.header[colIndex].name;
        const pill = document.createElement('div');
        pill.className = 'group-pill';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = colName;
        pill.appendChild(nameSpan);
        
        const removeSpan = document.createElement('span');
        removeSpan.className = 'group-remove';
        removeSpan.textContent = '×';
        removeSpan.onclick = () => removeGroup(i);
        pill.appendChild(removeSpan);
        
        activeGroupsContainer.appendChild(pill);
    });
}

function removeGroup(index) {
    activeGroupFields.splice(index, 1);
    renderGroupPills();
    updateToolbarSelects();
    renderTable();
}

function extractText(node) {
    let html = node.innerHTML;
    html = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<\/p>/gi, '\n');
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return temp.innerText.trim();
}

// --- 核心渲染 ---
function renderTable() {
    emptyMask.style.display = 'none';
    tableContent.innerHTML = '';

    const table = document.createElement('table');
    
    // 1. ColGroup
    const colgroup = document.createElement('colgroup');
    let visibleColsCount = 0;
    columnStates.forEach(state => {
        if (state.deleted) return;
        visibleColsCount++;
        const col = document.createElement('col');
        // 既然已经计算了初始 width，直接使用
        col.style.width = (state.width || 120) + 'px'; 
        colgroup.appendChild(col);
    });
    table.appendChild(colgroup);

    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    // 2. 表头
    const trHead = document.createElement('tr');
    globalSchema.header.forEach((colDef, index) => {
        const state = columnStates[index];
        if (state.deleted) return;
        const th = document.createElement('th');
        th.innerHTML = `<div style="display:flex;justify-content:${colDef.type===2?'flex-end':'space-between'};align-items:center;">${colDef.name}</div>`;
        const resizer = document.createElement('div');
        resizer.className = 'col-resizer';
        initDragResize(resizer, th, index);
        th.appendChild(resizer);
        th.onclick = (e) => { if(!e.target.classList.contains('col-resizer')) showPopover(e, index); }
        if (colDef.type === 2) th.style.textAlign = 'right';
        trHead.appendChild(th);
    });
    thead.appendChild(trHead);

    // 3. 数据预处理
    const rowDataList = globalRows.map(tr => {
        const cells = Array.from(tr.querySelectorAll('td')).map(td => extractText(td));
        return { element: tr, cells: cells, id: cells[0] }; 
    });

    // 4. 渲染流程：分组 -> 内部层级 -> DOM
    if (activeGroupFields.length > 0) {
        // 分组模式
        const groupedData = recursiveGroup(rowDataList, 0);
        renderRecursiveRows(tbody, groupedData, 0, visibleColsCount);
    } else {
        // 无分组，直接处理全局层级
        if (parentRelationColIndex !== -1) {
            const hierarchyData = buildHierarchy(rowDataList, parentRelationColIndex);
            renderHierarchyRows(tbody, hierarchyData, 0);
        } else {
            // 平铺
            globalRows.forEach(tr => tbody.appendChild(createRow(tr)));
        }
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    tableContent.appendChild(table);
}

// 分组逻辑
function recursiveGroup(rows, level) {
    if (level >= activeGroupFields.length) return rows; // 叶子节点，返回 rows 数组
    const colIndex = activeGroupFields[level];
    const groups = {};
    rows.forEach(row => {
        const key = row.cells[colIndex] || '(空)';
        if (!groups[key]) groups[key] = [];
        groups[key].push(row);
    });
    return Object.keys(groups).map(key => ({
        key: key,
        children: recursiveGroup(groups[key], level + 1),
        colIndex: colIndex 
    }));
}

// 渲染分组行
function renderRecursiveRows(tbody, nodes, level, colspan) {
    // 如果 nodes 是行数组（叶子分组的内容）
    if (nodes.length > 0 && !nodes[0].key && nodes[0].element) {
        const rows = nodes;
        // 在当前分组范围内构建层级
        if (parentRelationColIndex !== -1) {
            const hierarchyData = buildHierarchy(rows, parentRelationColIndex);
            renderHierarchyRows(tbody, hierarchyData, 0);
        } else {
            rows.forEach(r => tbody.appendChild(createRow(r.element)));
        }
        return;
    }

    // 否则是分组节点
    nodes.forEach(node => {
        const tr = document.createElement('tr');
        tr.className = `group-row`;
        const td = document.createElement('td');
        td.colSpan = colspan;
        td.style.paddingLeft = `${12 + level * 20}px`;
        const wrapper = document.createElement('div');
        wrapper.className = 'group-content-wrapper';
        // wrapper.innerHTML = `<span class="group-expander">▼</span>`;
        
        const colDef = globalSchema.header[node.colIndex];
        wrapper.appendChild(createCellContent(node.key, colDef));
        const countSpan = document.createElement('span');
        countSpan.style.color = '#8f959e'; countSpan.style.marginLeft = '8px';
        countSpan.textContent = `${countLeafRows(node)}`;
        wrapper.appendChild(countSpan);
        td.appendChild(wrapper); tr.appendChild(td); tbody.appendChild(tr);

        renderRecursiveRows(tbody, node.children, level + 1, colspan);
    });
}

function countLeafRows(node) {
    if (Array.isArray(node)) return node.length; // rows array
    if (node.children) {
        if (Array.isArray(node.children) && node.children.length > 0 && node.children[0].element) return node.children.length;
        return node.children.reduce((sum, child) => sum + countLeafRows(child), 0);
    }
    return 0;
}

// --- 逻辑 B: 父子层级构建 ---
function buildHierarchy(rows, parentColIdx) {
    const map = {};
    const roots = [];
    
    // 建立索引
    rows.forEach(row => {
        if (row.id) map[row.id] = { ...row, children: [] };
    });

    rows.forEach(row => {
        const selfId = row.id;
        const parentId = row.cells[parentColIdx];
        
        // 关键修正：防止自引用 && 确保父存在
        if (parentId && map[parentId] && parentId !== selfId) {
            map[parentId].children.push(map[selfId]);
        } else {
            // 如果在当前范围内找不到父亲，则作为根显示
            if (map[selfId]) roots.push(map[selfId]);
            else roots.push({ ...row, children: [] });
        }
    });
    return roots;
}

function renderHierarchyRows(tbody, nodes, indentLevel) {
    nodes.forEach(node => {
        const tr = createRow(node.element, indentLevel);
        tbody.appendChild(tr);
        if (node.children && node.children.length > 0) {
            renderHierarchyRows(tbody, node.children, indentLevel + 1);
        }
    });
}

// --- 通用行创建 ---
function createRow(sourceTr, indentLevel = 0) {
    const targetTr = document.createElement('tr');
    const sourceTds = sourceTr.querySelectorAll('td');

    globalSchema.header.forEach((colDef, index) => {
        if (columnStates[index].deleted) return;
        const targetTd = document.createElement('td');
        
        if (index === 0 && indentLevel > 0) {
            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex'; wrapper.style.alignItems = 'center';
            
            wrapper.style.paddingLeft = (indentLevel * 24) + 'px';
            
            // 拐角
            const icon = document.createElement('span');
            icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#bbb" stroke-width="2" style="display:block;"><path d="M4 0v12a2 2 0 0 0 2 2h10"/></svg>`;
            icon.style.marginRight = '6px';
            icon.style.marginTop = '-8px'; // 调整位置对齐文本
            wrapper.appendChild(icon);

            wrapper.innerHTML = '';
            wrapper.style.paddingLeft = (indentLevel * 20) + 'px';
            wrapper.appendChild(icon);

            if (index < sourceTds.length) {
                const rawText = extractText(sourceTds[index]);
                wrapper.appendChild(createCellContent(rawText, colDef));
            }
            targetTd.appendChild(wrapper);
        } else {
            if (index < sourceTds.length) {
                const rawText = extractText(sourceTds[index]);
                targetTd.appendChild(createCellContent(rawText, colDef));
            }
        }
        if (colDef.type === 2 || colDef.type === 20) targetTd.classList.add('cell-number');
        targetTr.appendChild(targetTd);
    });
    return targetTr;
}

// --- 内容生成 ---
function getColorIndex(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return Math.abs(hash % 6);
}

function createCellContent(text, colDef) {
    const fragment = document.createDocumentFragment();
    if (!text) return fragment;

    if (colDef.type === 3 || colDef.type === 4) {
        const labels = text.split(/,|，|\r|\n/);
        let hasTags = false;
        labels.forEach(label => {
            const clean = label.trim(); if (!clean) return;
            hasTags = true;
            const span = document.createElement('span'); span.className = 'bit-tag'; span.textContent = clean;
            let colorIdx;
            const opt = colDef.property?.options?.find(o => o.name === clean);
            colorIdx = opt ? opt.color % 6 : getColorIndex(clean);
            span.classList.add(`c-${colorIdx}`);
            fragment.appendChild(span);
        });
        if(!hasTags) fragment.textContent = text;
        return fragment;
    }

    if (colDef.type === 11) {
        const rawParts = text.split(/@|，|,|\s+/);
        const names = rawParts.filter(n => n.trim().length > 0);
        names.forEach(name => {
            const clean = name.trim();
            const span = document.createElement('span'); span.className = 'bit-user';
            // const avatar = document.createElement('span'); avatar.className = 'bit-user-avatar';
            // avatar.textContent = clean.charAt(0);
            // span.appendChild(avatar);
            span.appendChild(document.createTextNode(clean));
            fragment.appendChild(span);
        });
        return fragment;
    }

    if (colDef.type === 15 || text.startsWith('http')) {
            const a = document.createElement('a'); a.href = text; a.textContent = text; a.target = "_blank"; a.style.color = "var(--primary)";
            fragment.appendChild(a); return fragment;
    }

    fragment.textContent = text;
    return fragment;
}

function initDragResize(resizer, th, colIndex) {
    let startX, startWidth;
    resizer.addEventListener('mousedown', (e) => {
        e.stopPropagation(); startX = e.pageX;
        startWidth = th.getBoundingClientRect().width;
        th.classList.add('is-resizing'); document.body.style.cursor = 'col-resize';
        document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    });
    function onMove(e) {
        let w = startWidth + (e.pageX - startX);
        w = Math.max(10, Math.min(1000, w)); // 限制范围 [10, 400]
        columnStates[colIndex].width = w; updateColWidthDOM(colIndex, w);
        if (activeColIndex === colIndex && popover.style.display !== 'none') widthInput.value = w;
    }
    function onUp() {
        document.body.style.cursor = ''; th.classList.remove('is-resizing');
        document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
    }
}
function updateColWidthDOM(dataIndex, w) {
    let vIdx = 0; for(let i=0; i<dataIndex; i++) if(!columnStates[i].deleted) vIdx++;
    const col = tableContent.querySelector('colgroup').children[vIdx];
    if(col) col.style.width = w + 'px';
}
function showPopover(e, idx) {
    e.stopPropagation(); activeColIndex = idx;
    const th = e.target.closest('th'); const r = th.getBoundingClientRect();
    widthInput.value = columnStates[idx].width || Math.round(r.width);
    popover.style.display = 'block';
    popover.style.left = (r.left + r.width/2 - 100) + 'px';
    popover.style.top = (r.top - popover.offsetHeight - 8) + 'px';
}
function hidePopover() { popover.style.display = 'none'; activeColIndex = -1; }

widthInput.onchange = (e) => {
    if (activeColIndex > -1) {
        let val = parseInt(e.target.value);
        if (isNaN(val)) return;
        val = Math.max(10, Math.min(400, val)); // 限制范围 [10, 400]
        e.target.value = val; // 回填修正后的值
        columnStates[activeColIndex].width = val;
        updateColWidthDOM(activeColIndex, val);
    }
};
// 移除旧的 oninput，改用 onchange 避免输入一半时跳动，或者保留 oninput 但优化逻辑
widthInput.oninput = (e) => {
    // 仅实时更新视图，不强制修正 input value 以免打断输入
    if (activeColIndex > -1) {
        let val = parseInt(e.target.value);
        if (!isNaN(val)) {
             // 实时预览不限制严格范围，但在应用到 DOM 时限制，防止输入 1 变成 10 导致无法输入 100
             // 这里为了体验，只在有效范围内更新 DOM
             if (val >= 10 && val <= 400) {
                 columnStates[activeColIndex].width = val;
                 updateColWidthDOM(activeColIndex, val);
             }
        }
    }
};
deleteBtn.onclick = () => { if(activeColIndex>-1) { columnStates[activeColIndex].deleted = true; hidePopover(); renderTable(); } };
