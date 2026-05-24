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
    btn.innerHTML = '<svg viewBox="0 0 20 20" fill="none"><path d="M10 5v10M5 10h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    btn.style.display = 'none';
    document.body.appendChild(btn);
    this.floatingBtn = btn;

    btn.onclick = () => this.createHighlight();
  },

  createPopover() {
    const popover = document.createElement('div');
    popover.className = 'highlight-popover glass';
    popover.style.display = 'none';
    popover.innerHTML = `
      <div class="popover-content">
        <div class="popover-header">
          <span>Comentários</span>
          <button class="popover-close">×</button>
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

    popover.querySelector('#popoverAdd').onclick = () => this.addComment();
    popover.querySelector('#popoverInput').onkeypress = (e) => {
      if (e.key === 'Enter') this.addComment();
    };
  },

  setupListeners() {
    const container = document.getElementById('treeContainer');
    if (!container) return;

    // Only listen for mouseup on note bodies within the tree container
    container.addEventListener('mouseup', (e) => {
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
    });

    // Handle clicks on highlights - delegated to container
    container.addEventListener('click', (e) => {
      const highlightEl = e.target.closest('.note-highlight');
      if (highlightEl) {
        this.openPopover(highlightEl);
      }
    });

    // Close floating button on click elsewhere
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.highlight-float-btn') && !window.getSelection().toString()) {
        this.floatingBtn.style.display = 'none';
      }
    });
  },

  handleSelection(selection, noteBody) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Calculate offsets relative to the note text
    const offsets = this.getSelectionOffsets(noteBody, selection);

    // Find note ID
    const nodeEl = noteBody.closest('.tree-node');
    // We need a way to map the element back to the node data
    // Usually tree.js renders nodes with specific IDs.
    // Let's assume we can find the node ID from the tree rendering logic or by traversal.
    // In tree.js, we don't explicitly set data-id on the header or node.
    // I should probably add data-id to the node element in tree.js.

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
    const preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(container);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    const start = preSelectionRange.toString().length;

    return {
      start: start,
      end: start + selection.toString().length
    };
  },

  findNodeId(el) {
    const nodeEl = el.closest('.tree-node');
    // We'll need to modify tree.js to include the ID
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

    // Re-render the tree to show the highlight
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

    // Position intelligently
    let top = window.scrollY + rect.bottom + 10;
    let left = window.scrollX + rect.left;

    // Boundary checks
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
  }
};

window.Highlights = Highlights;
