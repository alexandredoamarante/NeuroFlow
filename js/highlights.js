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
    // Use a "marker" icon
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
          <button class="popover-unmark" id="popoverUnmark">Desmarcar</button>
          <span>Nota Técnica</span>
          <button class="popover-close">×</button>
        </div>

        <div class="color-picker" id="colorPicker">
          <div class="color-opt" data-color="rgba(250, 204, 21, 0.4)" style="background: #facc15"></div>
          <div class="color-opt" data-color="rgba(34, 197, 94, 0.4)" style="background: #22c55e"></div>
          <div class="color-opt" data-color="rgba(59, 130, 246, 0.4)" style="background: #3b82f6"></div>
          <div class="color-opt" data-color="rgba(239, 68, 68, 0.4)" style="background: #ef4444"></div>
          <div class="color-opt" data-color="rgba(168, 85, 247, 0.4)" style="background: #a855f7"></div>
        </div>

        <div class="popover-single-comment" id="popoverComment"></div>

        <div class="popover-input-row">
          <textarea id="popoverInput" placeholder="Escreva um comentário..." rows="1"></textarea>
          <button id="popoverSave">Salvar</button>
        </div>
      </div>
    `;
    document.body.appendChild(popover);
    this.popover = popover;

    popover.querySelector('.popover-close').onclick = () => {
      this.popover.style.display = 'none';
    };

    popover.querySelector('#popoverUnmark').onclick = () => this.removeHighlight();
    popover.querySelector('#popoverSave').onclick = () => this.saveComment();

    popover.querySelectorAll('.color-opt').forEach(opt => {
      opt.onclick = () => this.updateColor(opt.dataset.color);
    });

    popover.querySelector('#popoverInput').onkeypress = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.saveComment();
      }
    };
  },

  setupListeners() {
    const container = document.getElementById('treeContainer');
    if (!container) return;

    const handleSelectionEnd = (e) => {
      // Use a small timeout to ensure selection is complete
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

    // Handle clicks on highlights - delegated to container
    container.addEventListener('click', (e) => {
      const highlightEl = e.target.closest('.note-highlight');
      if (highlightEl) {
        e.stopPropagation();
        this.openPopover(highlightEl);
      }
    });

    // Close floating button on click elsewhere within the container
    container.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.highlight-float-btn') && !e.target.closest('.note-highlight') && !e.target.closest('.highlight-popover')) {
        this.floatingBtn.style.display = 'none';
        if (!window.getSelection().toString()) {
           this.popover.style.display = 'none';
        }
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

    // Find the start source offset
    let startOffset = -1;
    let endOffset = -1;

    const findSourceOffset = (node, offset, isStart) => {
      let current = node;
      // If node is a text node, its parent should have the source info
      if (current.nodeType === Node.TEXT_NODE) {
        current = current.parentElement;
      }

      const sourceEl = current.closest('[data-source-start]');
      if (sourceEl) {
        const base = parseInt(sourceEl.dataset.sourceStart);
        // We need to account for the offset within the text node if multiple text nodes exist in the span
        // But our render logic creates 1 span per part, so usually node is the only child.
        // To be safe, we sum up previous sibling lengths if any.
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

    startOffset = findSourceOffset(range.startContainer, range.startOffset, true);
    endOffset = findSourceOffset(range.endContainer, range.endOffset, false);

    // Fallback to text length if for some reason spans are missing source data
    if (startOffset === -1) {
      const preSelectionRange = range.cloneRange();
      preSelectionRange.selectNodeContents(container);
      preSelectionRange.setEnd(range.startContainer, range.startOffset);
      startOffset = preSelectionRange.toString().length;
      endOffset = startOffset + selection.toString().length;
    }

    return {
      start: startOffset,
      end: endOffset
    };
  },

  findNodeId(el) {
    const nodeEl = el.closest('.tree-node');
    // We'll need to modify tree.js to include the ID
    return nodeEl.dataset.id;
  },

  showFloatingBtn(rect) {
    this.floatingBtn.style.display = 'flex';

    let top = window.scrollY + rect.top - 45;
    let left = window.scrollX + rect.left + rect.width / 2 - 17;

    // Viewport boundaries
    if (top < window.scrollY + 10) top = window.scrollY + rect.bottom + 10;
    if (left < 10) left = 10;
    if (left + 40 > window.innerWidth) left = window.innerWidth - 50;

    this.floatingBtn.style.top = `${top}px`;
    this.floatingBtn.style.left = `${left}px`;
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
      comment: '',
      color: 'rgba(250, 204, 21, 0.4)', // Default yellow
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

    const popHeight = this.popover.offsetHeight;
    const popWidth = this.popover.offsetWidth;

    // Position intelligently
    let top = window.scrollY + rect.bottom + 10;
    let left = window.scrollX + rect.left + rect.width / 2 - popWidth / 2;

    // Boundary checks
    if (left + popWidth > window.innerWidth - 10) left = window.innerWidth - popWidth - 10;
    if (left < 10) left = 10;

    if (top + popHeight > window.scrollY + window.innerHeight - 10) {
      top = window.scrollY + rect.top - popHeight - 10;
    }
    if (top < window.scrollY + 10) top = window.scrollY + 10;

    this.popover.style.top = `${top}px`;
    this.popover.style.left = `${left}px`;
  },

  renderComments() {
    const display = this.popover.querySelector('#popoverComment');
    const input = this.popover.querySelector('#popoverInput');
    const highlight = this.activeHighlight.highlight;

    display.innerHTML = '';

    if (highlight.comment) {
      const textDiv = document.createElement('div');
      textDiv.className = 'comment-text scrollable';
      // Use renderSafeLinks equivalent here for clickable links
      this.renderCommentText(highlight.comment, textDiv);
      display.appendChild(textDiv);
      input.value = highlight.comment;
    } else {
      const empty = document.createElement('div');
      empty.className = 'comment-empty';
      empty.textContent = 'Sem comentário. Escreva abaixo para adicionar.';
      display.appendChild(empty);
      input.value = '';
    }

    // Highlight active color
    this.popover.querySelectorAll('.color-opt').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.color === highlight.color);
    });
  },

  renderCommentText(text, container) {
    // Basic link detection
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
    const parts = text.split(urlRegex);

    parts.forEach(part => {
      if (!part) return;
      if (part.match(urlRegex)) {
        let href = part;
        if (part.startsWith('www.')) href = 'http://' + part;
        const a = document.createElement('a');
        a.href = href;
        a.className = 'node-link';
        a.textContent = part;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.onclick = (e) => e.stopPropagation();
        container.appendChild(a);
      } else {
        container.appendChild(document.createTextNode(part));
      }
    });
  },

  saveComment() {
    const input = this.popover.querySelector('#popoverInput');
    const text = input.value.trim();

    this.activeHighlight.highlight.comment = text;
    Storage.saveTask(this.activeHighlight.task);
    this.renderComments();
  },

  updateColor(color) {
    this.activeHighlight.highlight.color = color;
    Storage.saveTask(this.activeHighlight.task);
    this.renderComments();

    // Re-render the tree to update the visual highlight color
    const taskId = new URLSearchParams(window.location.search).get('id');
    if (typeof renderTree === 'function') {
      currentNodes = this.activeHighlight.task.nodes;
      renderTree(currentNodes, document.getElementById('treeContainer'), taskId);
    }
  },

  removeHighlight() {
    if (!confirm('Deseja remover este destaque e todos os seus comentários?')) return;

    const { node, highlight, task } = this.activeHighlight;
    node.highlights = node.highlights.filter(h => h.id !== highlight.id);
    Storage.saveTask(task);

    this.popover.style.display = 'none';

    // Re-render the tree
    const taskId = new URLSearchParams(window.location.search).get('id');
    if (typeof renderTree === 'function') {
      currentNodes = task.nodes;
      renderTree(currentNodes, document.getElementById('treeContainer'), taskId);
    }
  }
};

window.Highlights = Highlights;
