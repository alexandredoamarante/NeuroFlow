const Highlights = {
  activeSelection: null,
  floatingBtn: null,
  popover: null,

  init() {
    this.createFloatingBtn();
    this.createPopover();
    this.setupListeners();
  },

  createFloatingBtn() {
    const btn = document.createElement('button');
    btn.className = 'highlight-float-btn glass';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16.4745 5.4082L18.5917 7.52538M17.8358 3.54289L12.1086 9.27008C11.833 9.54574 11.66 9.90793 11.6163 10.2952L11.0163 15.6179C10.9765 15.9712 11.2788 16.2735 11.6321 16.2337L16.9548 15.6337C17.3421 15.59 17.7043 15.417 17.9799 15.1414L23.7071 9.41421C24.0976 9.02369 24.0976 8.39052 23.7071 8L19.25 3.54289C18.8595 3.15237 18.2263 3.15237 17.8358 3.54289Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M9 16.2337H3V21.2337H21V15.2337" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    btn.style.display = 'none';
    btn.title = "Destacar e comentar";
    document.body.appendChild(btn);
    this.floatingBtn = btn;

    btn.onclick = (e) => {
      e.stopPropagation();
      this.createHighlight();
    };
  },

  createPopover() {
    const popover = document.createElement('div');
    popover.className = 'highlight-popover glass';
    popover.style.display = 'none';
    popover.innerHTML = `
      <div class="popover-content">
        <div class="popover-header">
          <span>Comentários</span>
          <div style="display:flex; gap: 8px; align-items: center;">
            <button id="popoverUnmark" class="lg-btn danger sm" style="padding: 2px 6px; font-size: 0.65rem;">Desmarcar</button>
            <button class="popover-close">×</button>
          </div>
        </div>
        <div class="popover-list" id="popoverList"></div>
        <div class="popover-input-row">
          <input type="text" id="popoverInput" placeholder="Adicionar comentário..." autocomplete="off">
          <button id="popoverAdd">Enviar</button>
        </div>
      </div>
    `;
    document.body.appendChild(popover);
    this.popover = popover;

    popover.querySelector('.popover-close').onclick = () => {
      this.popover.style.display = 'none';
    };

    popover.querySelector('#popoverUnmark').onclick = () => this.deleteHighlight();
    popover.querySelector('#popoverAdd').onclick = () => this.addComment();
    popover.querySelector('#popoverInput').onkeypress = (e) => {
      if (e.key === 'Enter') this.addComment();
    };
  },

  setupListeners() {
    const container = document.getElementById('treeContainer');
    if (!container) return;

    const handleSelectionEnd = (e) => {
      setTimeout(() => {
        const selection = window.getSelection();
        const noteBody = e.target.closest('.node-body-text');

        if (noteBody && selection.toString().trim().length > 0) {
          this.handleSelection(selection, noteBody);
        } else {
          if (!e.target.closest('.highlight-float-btn')) {
            this.floatingBtn.style.display = 'none';
            this.activeSelection = null;
          }
        }
      }, 50);
    };

    container.addEventListener('mouseup', handleSelectionEnd);
    container.addEventListener('touchend', handleSelectionEnd);

    container.addEventListener('click', (e) => {
      const highlightEl = e.target.closest('.note-highlight');
      if (highlightEl) {
        e.stopPropagation();
        this.openPopover(highlightEl);
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.highlight-float-btn') && !e.target.closest('.highlight-popover') && !window.getSelection().toString()) {
        this.floatingBtn.style.display = 'none';
        this.popover.style.display = 'none';
      }
    });
  },

  handleSelection(selection, noteBody) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const offsets = this.getSelectionOffsets(noteBody, selection);

    this.activeSelection = {
      noteId: this.findNodeId(noteBody),
      text: selection.toString(),
      start: offsets.start,
      end: offsets.end,
      rect: rect
    };

    this.showFloatingBtn(rect);
  },

  getSelectionOffsets(container, selection) {
    const range = selection.getRangeAt(0);
    let startOffset = -1;
    let endOffset = -1;

    const findSourceOffset = (node, offset) => {
      let current = node;
      if (current.nodeType === Node.TEXT_NODE) {
        current = current.parentElement;
      }

      const sourceEl = current.closest('[data-source-start]');
      if (sourceEl) {
        const base = parseInt(sourceEl.dataset.sourceStart);
        let internalOffset = offset;
        let sib = node.previousSibling;
        while(sib) {
          internalOffset += sib.textContent.length;
          sib = sib.previousSibling;
        }
        return base + internalOffset;
      }
      return -1;
    };

    startOffset = findSourceOffset(range.startContainer, range.startOffset);
    endOffset = findSourceOffset(range.endContainer, range.endOffset);

    if (startOffset === -1) {
      const preSelectionRange = range.cloneRange();
      preSelectionRange.selectNodeContents(container);
      preSelectionRange.setEnd(range.startContainer, range.startOffset);
      startOffset = preSelectionRange.toString().length;
      endOffset = startOffset + selection.toString().length;
    }

    return { start: startOffset, end: endOffset };
  },

  findNodeId(el) {
    const nodeEl = el.closest('.tree-node');
    return nodeEl.dataset.id;
  },

  showFloatingBtn(rect) {
    this.floatingBtn.style.display = 'flex';
    this.floatingBtn.style.top = `${window.scrollY + rect.top - 40}px`;
    this.floatingBtn.style.left = `${window.scrollX + rect.left + rect.width / 2 - 15}px`;
  },

  async createHighlight() {
    if (!this.activeSelection) return;

    const { noteId, start, end, text } = this.activeSelection;
    const taskId = new URLSearchParams(window.location.search).get('id');
    const task = Storage.getTask(taskId);

    if (!task) return;

    const node = this.findNodeInData(task.nodes, noteId);
    if (!node) return;

    if (!node.highlights) node.highlights = [];

    const newHighlight = {
      id: Date.now().toString(),
      start,
      end,
      text,
      comments: [],
      createdAt: new Date().toISOString()
    };

    node.highlights.push(newHighlight);
    Storage.saveTask(task);

    this.floatingBtn.style.display = 'none';
    window.getSelection().removeAllRanges();

    if (typeof renderTree === 'function') {
      currentNodes = task.nodes;
      renderTree(currentNodes, document.getElementById('treeContainer'), taskId);
    }
  },

  findNodeInData(nodes, id) {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const found = this.findNodeInData(n.children, id);
        if (found) return found;
      }
    }
    return null;
  },

  activeHighlight: null,

  openPopover(el) {
    const highlightId = el.dataset.id;
    const noteId = el.dataset.noteId;
    const taskId = new URLSearchParams(window.location.search).get('id');
    const task = Storage.getTask(taskId);

    const node = this.findNodeInData(task.nodes, noteId);
    if (!node) return;

    const highlight = node.highlights.find(h => h.id === highlightId);
    if (!highlight) return;

    this.activeHighlight = { task, node, highlight };
    this.renderComments();

    const rect = el.getBoundingClientRect();
    this.popover.style.display = 'block';

    let top = window.scrollY + rect.bottom + 10;
    let left = window.scrollX + rect.left;

    if (left + 300 > window.innerWidth) left = window.innerWidth - 320;
    if (top + 200 > window.scrollY + window.innerHeight) top = window.scrollY + rect.top - 210;

    this.popover.style.top = `${top}px`;
    this.popover.style.left = `${left}px`;
  },

  renderComments() {
    const list = this.popover.querySelector('#popoverList');
    list.innerHTML = '';

    this.activeHighlight.highlight.comments.forEach((c, idx) => {
      const item = document.createElement('div');
      item.className = 'comment-item';

      const textDiv = document.createElement('div');
      textDiv.className = 'comment-text';
      textDiv.textContent = c.text;

      const metaDiv = document.createElement('div');
      metaDiv.className = 'comment-meta';

      const dateSpan = document.createElement('span');
      dateSpan.textContent = new Date(c.date).toLocaleString();

      const delBtn = document.createElement('button');
      delBtn.className = 'comment-del';
      delBtn.textContent = 'Excluir';
      delBtn.onclick = () => this.deleteComment(idx);

      metaDiv.appendChild(dateSpan);
      metaDiv.appendChild(delBtn);

      item.appendChild(textDiv);
      item.appendChild(metaDiv);
      list.appendChild(item);
    });

    if (this.activeHighlight.highlight.comments.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'comment-empty';
      empty.textContent = 'Nenhum comentário ainda.';
      list.appendChild(empty);
    }
  },

  addComment() {
    const input = this.popover.querySelector('#popoverInput');
    const text = input.value.trim();
    if (!text) return;

    this.activeHighlight.highlight.comments.push({
      text,
      date: new Date().toISOString()
    });

    Storage.saveTask(this.activeHighlight.task);
    input.value = '';
    this.renderComments();
  },

  deleteComment(idx) {
    this.activeHighlight.highlight.comments.splice(idx, 1);
    Storage.saveTask(this.activeHighlight.task);
    this.renderComments();
  },

  deleteHighlight() {
    if (!confirm('Deseja desmarcar este texto e remover todos os seus comentários?')) return;
    const { node, highlight, task } = this.activeHighlight;
    node.highlights = node.highlights.filter(h => h.id !== highlight.id);
    Storage.saveTask(task);
    this.popover.style.display = 'none';
    const taskId = new URLSearchParams(window.location.search).get('id');
    if (typeof renderTree === 'function') {
      currentNodes = task.nodes;
      renderTree(currentNodes, document.getElementById('treeContainer'), taskId);
    }
  }
};

window.Highlights = Highlights;
