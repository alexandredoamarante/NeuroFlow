const treeContainer = document.getElementById('treeContainer');
const treeEmpty = document.getElementById('treeEmpty');
const expandAllBtn = document.getElementById('expandAllBtn');
const collapseAllBtn = document.getElementById('collapseAllBtn');
const nodeModal = document.getElementById('nodeModal');
const nodeTextInput = document.getElementById('nodeTextInput');
const nodeBodyInput = document.getElementById('nodeBodyInput');
const nodeImgUrl = document.getElementById('nodeImgUrl');
const nodeImgFile = document.getElementById('nodeImgFile');
const nodeImgPreview = document.getElementById('nodeImgPreview');
const nodeImgClear = document.getElementById('nodeImgClear');
const imageViewer = document.getElementById('imageViewer');
const viewerImg = document.getElementById('viewerImg');
const modalSave = document.getElementById('modalSave');
const modalCancel = document.getElementById('modalCancel');
const modalDelete = document.getElementById('modalDelete');

const clearTitleBtn = document.getElementById('clearTitleBtn');
const clearBodyBtn = document.getElementById('clearBodyBtn');
const fmtGreenBtn = document.getElementById('fmtGreenBtn');
const fmtRedBtn = document.getElementById('fmtRedBtn');
const fmtClearBtn = document.getElementById('fmtClearBtn');

let currentNodes = [];
let editingNodeId = null;
let parentNodeId = null;

function renderTree(nodes, container, taskId) {
  if (container === treeContainer) window.currentNodes = nodes;
  container.innerHTML = '';
  if (nodes.length === 0 && container === treeContainer) {
    if (treeEmpty) treeEmpty.style.display = 'block';
    return;
  }
  if (container === treeContainer && treeEmpty) treeEmpty.style.display = 'none';

  nodes.forEach(node => {
    const nodeEl = document.createElement('div');
    nodeEl.className = 'tree-node';
    nodeEl.dataset.id = node.id;

    const header = document.createElement('div');
    header.className = 'node-header';

    const toggle = document.createElement('div');
    toggle.className = `node-toggle ${node.expanded ? 'expanded' : ''}`;
    toggle.textContent = node.children?.length ? '▶' : '•';

    const title = document.createElement('div');
    title.className = 'node-title';
    renderSafeLinks(node.text, title, false);

    const actions = document.createElement('div');
    actions.className = 'node-actions';

    const addBtn = document.createElement('button');
    addBtn.className = 'lg-btn ghost sm';
    addBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" style="width:14px;height:14px;"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    addBtn.onclick = (e) => { e.stopPropagation(); addNode(node.id); };

    const editBtn = document.createElement('button');
    editBtn.className = 'lg-btn ghost sm';
    editBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" style="width:14px;height:14px;"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" fill="currentColor"/></svg>';
    editBtn.onclick = (e) => { e.stopPropagation(); editNode(node.id); };

    const delBtn = document.createElement('button');
    delBtn.className = 'lg-btn ghost sm danger';
    delBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" style="width:14px;height:14px;"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    delBtn.onclick = (e) => { e.stopPropagation(); deleteNode(node.id); };

    actions.appendChild(addBtn);
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    header.appendChild(toggle);
    header.appendChild(title);
    header.appendChild(actions);

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'node-children';
    childrenContainer.style.display = node.expanded ? 'block' : 'none';

    header.onclick = () => {
      node.expanded = !node.expanded;
      saveCurrentNodes();
      renderTree(currentNodes, treeContainer, taskId);
    };

    nodeEl.appendChild(header);

    if (node.body || node.img) {
      const contentEl = document.createElement('div');
      contentEl.className = 'node-content';
      contentEl.style.display = node.expanded ? 'block' : 'none';

      if (node.img) {
        const img = document.createElement('img');
        img.src = node.img;
        img.className = 'node-img';
        img.onclick = (e) => {
          e.stopPropagation();
          viewerImg.src = node.img;
          imageViewer.style.display = 'flex';
        };
        contentEl.appendChild(img);
      }

      if (node.body) {
        const bodyText = document.createElement('div');
        bodyText.className = 'node-body-text';
        renderBodyWithHighlights(node, bodyText);
        contentEl.appendChild(bodyText);
      }

      nodeEl.appendChild(contentEl);
    }

    nodeEl.appendChild(childrenContainer);

    container.appendChild(nodeEl);
    if (node.children?.length) {
      renderTree(node.children, childrenContainer, taskId);
    }
  });
}

function renderBodyWithHighlights(node, container) {
    container.innerHTML = '';
    let text = node.body || '';
    let highlights = node.highlights || [];

    // Sort highlights by start position
    highlights.sort((a, b) => a.start - b.start);

    let lastIndex = 0;
    const fragment = document.createDocumentFragment();

    highlights.forEach(h => {
        if (h.start < lastIndex) return; // Skip overlapping

        // Text before highlight
        if (h.start > lastIndex) {
            renderSafeLinks(text.substring(lastIndex, h.start), fragment, true, lastIndex);
        }

        // The highlight itself
        const hSpan = document.createElement('span');
        hSpan.className = 'note-highlight';
        hSpan.dataset.id = h.id;
        hSpan.dataset.noteId = node.id;
        renderSafeLinks(text.substring(h.start, h.end), hSpan, true, h.start);
        if (h.comments && h.comments.length > 0) {
            hSpan.classList.add('has-comment');
        }
        fragment.appendChild(hSpan);

        lastIndex = h.end;
    });

    // Remaining text
    if (lastIndex < text.length) {
        renderSafeLinks(text.substring(lastIndex), fragment, true, lastIndex);
    }

    container.appendChild(fragment);
}

const wikiRegex = /^\[\[.*?\]\]$/;
const urlRegex = /^(https?:\/\/[^\s]+|www\.[^\s]+)$/;
const combinedRegex = /(\[\[.*?\]\]|https?:\/\/[^\s]+|www\.[^\s]+)/g;

function renderSafeLinks(text, container, applyColor = true, baseOffset = 0) {
  if (!text) return;
  const lines = text.split('\n');
  let currentOffset = baseOffset;

  lines.forEach((line, idx) => {
    const lineSpan = document.createElement('span');
    lineSpan.className = 'node-line-part';
    lineSpan.dataset.sourceStart = currentOffset;
    lineSpan.dataset.sourceLength = line.length;

    if (applyColor) {
        if (line.startsWith('>')) lineSpan.classList.add('greentext');
        else if (line.startsWith('<')) lineSpan.classList.add('redtext');
    }

    const parts = line.split(combinedRegex);
    parts.forEach(part => {
      if (!part) return;
      if (wikiRegex.test(part)) {
        const linkText = part.slice(2, -2);
        const span = document.createElement('span');
        span.className = 'node-link';
        span.textContent = linkText;
        span.onclick = (e) => {
          e.stopPropagation();
          navigateToNodeByTitle(linkText);
        };
        lineSpan.appendChild(span);
      } else if (urlRegex.test(part)) {
        let href = part;
        if (part.startsWith('www.')) href = 'http://' + part;
        const a = document.createElement('a');
        a.href = href;
        a.className = 'node-link';
        a.textContent = part;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.onclick = (e) => e.stopPropagation();
        lineSpan.appendChild(a);
      } else {
        lineSpan.appendChild(document.createTextNode(part));
      }
    });
    container.appendChild(lineSpan);
    if (idx < lines.length - 1) {
        const br = document.createElement('span');
        br.textContent = '\n';
        br.dataset.sourceStart = currentOffset + line.length;
        br.dataset.sourceLength = 1;
        container.appendChild(br);
        currentOffset += 1;
    }
    currentOffset += line.length;
  });
}

function navigateToNodeByTitle(title) {
  const target = findNodeByTitle(currentNodes, title);
  if (target) {
    expandParents(currentNodes, target.id);
    target.expanded = true;
    saveCurrentNodes();
    renderTree(currentNodes, treeContainer);

    setTimeout(() => {
      const els = document.querySelectorAll('.node-title');
      for (const el of els) {
        if (el.textContent === title) {
          const nodeEl = el.closest('.tree-node');
          nodeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          nodeEl.classList.add('highlight-link');
          setTimeout(() => nodeEl.classList.remove('highlight-link'), 2000);
          break;
        }
      }
    }, 100);
  } else {
    alert(`Nota "${title}" não encontrada.`);
  }
}

function findNodeByTitle(nodes, title) {
  for (const n of nodes) {
    if (n.text === title) return n;
    if (n.children) {
      const found = findNodeByTitle(n.children, title);
      if (found) return found;
    }
  }
  return null;
}

function expandParents(nodes, targetId) {
  for (const n of nodes) {
    if (isAncestor(n, targetId)) {
      n.expanded = true;
      if (n.children) expandParents(n.children, targetId);
      return true;
    }
  }
  return false;
}

function isAncestor(node, targetId) {
  if (node.id === targetId) return false;
  if (!node.children) return false;
  for (const child of node.children) {
    if (child.id === targetId || isAncestor(child, targetId)) return true;
  }
  return false;
}

function saveCurrentNodes() {
  const id = new URLSearchParams(window.location.search).get('id');
  const task = Storage.getTask(id);
  if (task) {
    task.nodes = currentNodes;
    Storage.saveTask(task);
  }
}

async function compressImage(dataUrl, maxWidth = 1200, maxHeight = 1200) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height *= maxWidth / width;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width *= maxHeight / height;
        height = maxHeight;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = dataUrl;
  });
}

function addNode(parentId = null) {
  editingNodeId = null;
  parentNodeId = parentId;
  nodeTextInput.value = '';
  nodeBodyInput.value = '';
  nodeImgUrl.value = '';
  nodeImgFile.value = '';
  nodeImgPreview.src = '';
  nodeImgPreview.style.display = 'none';
  nodeImgClear.style.display = 'none';
  modalDelete.style.display = 'none';
  nodeModal.style.display = 'flex';
  nodeModal.querySelector('#modalTitle').textContent = 'Nova anotação';
}

function editNode(id) {
  const node = findNode(currentNodes, id);
  editingNodeId = id;
  nodeTextInput.value = node.text || '';
  nodeBodyInput.value = node.body || '';
  nodeImgUrl.value = node.img || '';
  if (node.img) {
    nodeImgPreview.src = node.img;
    nodeImgPreview.style.display = 'block';
    nodeImgClear.style.display = 'block';
  } else {
    nodeImgPreview.style.display = 'none';
    nodeImgClear.style.display = 'none';
  }
  modalDelete.style.display = 'block';
  nodeModal.style.display = 'flex';
  nodeModal.querySelector('#modalTitle').textContent = 'Editar anotação';
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

function deleteNode(id) {
  if (!confirm('Excluir esta anotação e todas as suas sub-notas?')) return;
  currentNodes = removeNode(currentNodes, id);
  saveCurrentNodes();
  renderTree(currentNodes, treeContainer);
}

function removeNode(nodes, id) {
  return nodes.filter(n => {
    if (n.id === id) return false;
    if (n.children) n.children = removeNode(n.children, id);
    return true;
  });
}

modalSave?.addEventListener('click', async () => {
  const text = nodeTextInput.value;
  const body = nodeBodyInput.value;
  const img = nodeImgUrl.value.trim();

  if (!text.trim() && !body.trim() && !img) return;

  const taskId = new URLSearchParams(window.location.search).get('id');
  const task = Storage.getTask(taskId);
  if (task) currentNodes = task.nodes || [];

  if (editingNodeId) {
    const node = findNode(currentNodes, editingNodeId);
    if (node) {
      node.text = text;
      node.body = body;
      node.img = img;
    }
  } else {
    const newNode = {
      id: Date.now().toString(),
      text: text,
      body,
      img,
      expanded: true,
      children: [],
      highlights: []
    };
    if (parentNodeId) {
      const parent = findNode(currentNodes, parentNodeId);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(newNode);
        parent.expanded = true;
      } else {
        currentNodes.push(newNode);
      }
    } else {
      currentNodes.push(newNode);
    }
  }

  saveCurrentNodes();
  nodeModal.style.display = 'none';
  renderTree(currentNodes, treeContainer);
});

modalCancel?.addEventListener('click', () => nodeModal.style.display = 'none');

modalDelete?.addEventListener('click', () => {
  if (editingNodeId && confirm('Excluir esta anotação e todas as suas sub-notas?')) {
    deleteNode(editingNodeId);
    nodeModal.style.display = 'none';
  }
});

nodeImgFile?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const compressed = await compressImage(ev.target.result);
    nodeImgUrl.value = compressed;
    nodeImgPreview.src = compressed;
    nodeImgPreview.style.display = 'block';
    nodeImgClear.style.display = 'block';
  };
  reader.readAsDataURL(file);
});

nodeImgUrl?.addEventListener('input', async () => {
  const val = nodeImgUrl.value.trim();
  if (val) {
    if (val.startsWith('http')) {
      nodeImgPreview.src = val;
      nodeImgPreview.style.display = 'block';
      nodeImgClear.style.display = 'block';
    } else if (val.startsWith('data:image')) {
      const compressed = await compressImage(val);
      nodeImgUrl.value = compressed;
      nodeImgPreview.src = compressed;
      nodeImgPreview.style.display = 'block';
      nodeImgClear.style.display = 'block';
    }
  } else {
    nodeImgPreview.style.display = 'none';
    nodeImgClear.style.display = 'none';
  }
});

nodeImgClear?.addEventListener('click', () => {
  nodeImgUrl.value = '';
  nodeImgFile.value = '';
  nodeImgPreview.style.display = 'none';
  nodeImgClear.style.display = 'none';
});

clearTitleBtn?.addEventListener('click', () => { nodeTextInput.value = ''; nodeTextInput.focus(); });
clearBodyBtn?.addEventListener('click', () => { nodeBodyInput.value = ''; nodeBodyInput.focus(); });

fmtGreenBtn?.addEventListener('click', () => applyMarker('>'));
fmtRedBtn?.addEventListener('click', () => applyMarker('<'));
fmtClearBtn?.addEventListener('click', () => {
  const start = nodeBodyInput.selectionStart;
  const end = nodeBodyInput.selectionEnd;
  const text = nodeBodyInput.value;
  const before = text.substring(0, start);
  const selected = text.substring(start, end);
  const after = text.substring(end);
  const uncolored = selected.split('\n').map(line => {
    if (line.startsWith('>') || line.startsWith('<')) return line.substring(1).trimStart();
    return line;
  }).join('\n');
  nodeBodyInput.value = before + uncolored + after;
  nodeBodyInput.focus();
});

function applyMarker(marker) {
  const start = nodeBodyInput.selectionStart;
  const end = nodeBodyInput.selectionEnd;
  const text = nodeBodyInput.value;
  if (start === end) {
    const linesBefore = text.substring(0, start).split('\n');
    const currentLineIndex = linesBefore.length - 1;
    const allLines = text.split('\n');
    let line = allLines[currentLineIndex];
    if (line.startsWith(marker)) {}
    else if (line.startsWith('>') || line.startsWith('<')) allLines[currentLineIndex] = marker + line.substring(1);
    else allLines[currentLineIndex] = marker + line;
    nodeBodyInput.value = allLines.join('\n');
  } else {
    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end);
    const lines = selected.split('\n');
    const marked = lines.map(line => {
      if (line.startsWith(marker)) return line;
      if (line.startsWith('>') || line.startsWith('<')) return marker + line.substring(1);
      return marker + line;
    }).join('\n');
    nodeBodyInput.value = before + marked + after;
  }
  nodeBodyInput.focus();
}

function setAllExpanded(nodes, state) {
  nodes.forEach(n => {
    n.expanded = state;
    if (n.children) setAllExpanded(n.children, state);
  });
}

expandAllBtn?.addEventListener('click', () => {
  setAllExpanded(currentNodes, true);
  saveCurrentNodes();
  renderTree(currentNodes, treeContainer);
});

collapseAllBtn?.addEventListener('click', () => {
  setAllExpanded(currentNodes, false);
  saveCurrentNodes();
  renderTree(currentNodes, treeContainer);
});

imageViewer?.addEventListener('click', (e) => {
  if (e.target === imageViewer || e.target.closest('.viewer-close')) {
    imageViewer.style.display = 'none';
  }
});

window.addNode = addNode;
window.editNode = editNode;
window.deleteNode = deleteNode;
window.findNode = findNode;
window.renderTree = renderTree;
