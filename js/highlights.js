(function() {
    const highlightBtn = document.createElement('button');
    highlightBtn.id = 'highlightBtn';
    highlightBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="black" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>';
    highlightBtn.style.display = 'none';
    highlightBtn.className = 'highlight-fab';
    document.body.appendChild(highlightBtn);

    const annotationPopover = document.createElement('div');
    annotationPopover.id = 'annotationPopover';
    annotationPopover.className = 'glass annotation-popover';
    annotationPopover.style.display = 'none';
    annotationPopover.innerHTML = `
        <div class="popover-content">
            <textarea id="annotationInput" class="lg-textarea sm" placeholder="Adicionar nota..."></textarea>
            <div class="popover-actions">
                <button id="saveAnnotation" class="lg-btn primary sm">Salvar</button>
                <button id="deleteHighlight" class="lg-btn danger sm">Desmarcar</button>
            </div>
        </div>
        <div class="popover-arrow"></div>
    `;
    document.body.appendChild(annotationPopover);

    let currentSelection = null;
    let activeHighlightId = null;
    let activeNodeId = null;

    function handleSelection(e) {
        const selection = window.getSelection();
        const text = selection.toString().trim();

        if (!text || selection.isCollapsed) {
            if (e && !e.target.closest('#highlightBtn') && !e.target.closest('#annotationPopover')) {
                highlightBtn.style.display = 'none';
            }
            return;
        }

        const container = selection.anchorNode.parentElement.closest('.node-body-text');
        if (container) {
            currentSelection = {
                text,
                range: selection.getRangeAt(0).cloneRange()
            };

            const rect = currentSelection.range.getBoundingClientRect();
            highlightBtn.style.top = `${rect.top + window.scrollY - 40}px`;
            highlightBtn.style.left = `${rect.left + window.scrollX + (rect.width / 2) - 16}px`;
            highlightBtn.style.display = 'flex';
        } else {
            highlightBtn.style.display = 'none';
        }
    }

    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('touchend', handleSelection);

    highlightBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });

    highlightBtn.addEventListener('click', () => {
        if (!currentSelection) return;

        const nodeId = findNodeIdFromElement(currentSelection.range.startContainer);
        if (!nodeId) return;

        const bodyEl = document.querySelector(`[data-node-id="${nodeId}"] .node-body-text`);
        const highlight = {
            id: Date.now().toString(),
            text: currentSelection.text,
            comment: '',
            start: getSelectionOffset(currentSelection.range, bodyEl),
            length: currentSelection.text.length
        };

        addHighlightToNode(nodeId, highlight);
        highlightBtn.style.display = 'none';
        window.getSelection().removeAllRanges();

        showPopover(highlight.id, nodeId);
    });

    function findNodeIdFromElement(el) {
        const nodeRoot = (el.nodeType === 3 ? el.parentElement : el).closest('.tree-node');
        return nodeRoot ? nodeRoot.getAttribute('data-node-id') : null;
    }

    function getSelectionOffset(range, container) {
        const linePart = range.startContainer.parentElement.closest('.node-line-part');
        if (linePart) {
            const base = parseInt(linePart.getAttribute('data-source-start') || '0', 10);
            let offsetInLine = 0;
            const walker = document.createTreeWalker(linePart, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while ((node = walker.nextNode())) {
                if (node === range.startContainer) {
                    offsetInLine += range.startOffset;
                    break;
                }
                offsetInLine += node.textContent.length;
            }
            return base + offsetInLine;
        }

        // Fallback for non-line-part cases (should not happen with current tree.js)
        let offset = 0;
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
            if (node === range.startContainer) {
                offset += range.startOffset;
                break;
            }
            offset += node.textContent.length;
            // Handle BRs if needed, but tree.js uses line-parts
        }
        return offset;
    }

    function addHighlightToNode(nodeId, highlight) {
        const id = new URLSearchParams(window.location.search).get('id');
        const task = Storage.getTask(id);
        if (!task) return;

        const node = window.findNode(task.nodes, nodeId);
        if (node) {
            if (!node.highlights) node.highlights = [];
            node.highlights.push(highlight);
            Storage.saveTask(task);
            // Re-render
            window.currentNodes = task.nodes;
            window.renderTree(window.currentNodes, document.getElementById('treeContainer'));
        }
    }

    function showPopover(highlightId, nodeId, x, y) {
        activeHighlightId = highlightId;
        activeNodeId = nodeId;

        const id = new URLSearchParams(window.location.search).get('id');
        const task = Storage.getTask(id);
        const node = window.findNode(task.nodes, nodeId);
        if (!node) return;
        const highlight = node.highlights.find(h => h.id === highlightId);
        if (!highlight) return;

        const input = document.getElementById('annotationInput');
        input.value = highlight.comment || '';

        annotationPopover.style.display = 'block';

        if (x !== undefined && y !== undefined) {
            annotationPopover.style.top = `${y + window.scrollY + 10}px`;
            annotationPopover.style.left = `${Math.max(10, Math.min(window.innerWidth - 250, x + window.scrollX - 120))}px`;
        } else {
            const rect = highlightBtn.getBoundingClientRect();
            annotationPopover.style.top = `${rect.bottom + window.scrollY + 5}px`;
            annotationPopover.style.left = `${Math.max(10, Math.min(window.innerWidth - 250, rect.left + window.scrollX - 100))}px`;
        }
        input.focus();
    }

    document.getElementById('saveAnnotation').addEventListener('click', () => {
        const comment = document.getElementById('annotationInput').value;
        updateHighlightComment(activeNodeId, activeHighlightId, comment);
        annotationPopover.style.display = 'none';
    });

    document.getElementById('deleteHighlight').addEventListener('click', () => {
        removeHighlightFromNode(activeNodeId, activeHighlightId);
        annotationPopover.style.display = 'none';
    });

    function updateHighlightComment(nodeId, highlightId, comment) {
        const id = new URLSearchParams(window.location.search).get('id');
        const task = Storage.getTask(id);
        const node = window.findNode(task.nodes, nodeId);
        if (node) {
            const h = node.highlights.find(hi => hi.id === highlightId);
            if (h) h.comment = comment;
            Storage.saveTask(task);
            window.currentNodes = task.nodes;
            window.renderTree(window.currentNodes, document.getElementById('treeContainer'));
        }
    }

    function removeHighlightFromNode(nodeId, highlightId) {
        const id = new URLSearchParams(window.location.search).get('id');
        const task = Storage.getTask(id);
        const node = window.findNode(task.nodes, nodeId);
        if (node) {
            node.highlights = node.highlights.filter(h => h.id !== highlightId);
            Storage.saveTask(task);
            window.currentNodes = task.nodes;
            window.renderTree(window.currentNodes, document.getElementById('treeContainer'));
        }
    }

    document.addEventListener('click', (e) => {
        const highlightEl = e.target.closest('.note-highlight');
        if (highlightEl) {
            const hid = highlightEl.getAttribute('data-highlight-id');
            const nid = highlightEl.closest('.tree-node').getAttribute('data-node-id');
            showPopover(hid, nid, e.clientX, e.clientY);
        } else if (!e.target.closest('#annotationPopover') && !e.target.closest('#highlightBtn')) {
            annotationPopover.style.display = 'none';
        }
    });

    window.Highlights = {
        showPopover
    };
})();
