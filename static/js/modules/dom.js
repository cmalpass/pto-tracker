export function clearElement(element) {
    element.replaceChildren();
}

export function text(value) {
    return document.createTextNode(String(value ?? ''));
}

export function element(tagName, className, content) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (content !== undefined) node.append(content);
    return node;
}

export function appendText(parent, tagName, className, value) {
    const node = element(tagName, className);
    node.textContent = String(value ?? '');
    parent.append(node);
    return node;
}

export function setText(selector, value) {
    const node = document.querySelector(selector);
    if (node) node.textContent = String(value ?? '');
    return node;
}

const dialogStates = new WeakMap();
let toastTimer;
const focusableSelector = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])'
].join(',');

export function announce(message) {
    const region = document.getElementById('announcements');
    if (!region) return;
    region.textContent = '';
    region.textContent = String(message ?? '');
}

export function setupDialog(dialog, onClose) {
    if (!dialog) return;
    dialogStates.set(dialog, { onClose, previousFocus: null });
    dialog.addEventListener('click', event => {
        if (event.target === dialog) onClose();
    });
    dialog.addEventListener('keydown', event => {
        if (!dialog.classList.contains('active')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [...dialog.querySelectorAll(focusableSelector)]
            .filter(node => !node.hidden && node.getClientRects().length);
        if (!focusable.length) {
            event.preventDefault();
            dialog.focus();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
}

export function openDialog(dialog, initialFocusSelector) {
    const state = dialogStates.get(dialog);
    if (state) state.previousFocus = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.classList.add('active');
    dialog.setAttribute('aria-hidden', 'false');
    const initialFocus = initialFocusSelector ? dialog.querySelector(initialFocusSelector) : null;
    (initialFocus || dialog).focus({ preventScroll: true });
}

export function closeDialog(dialog) {
    const state = dialogStates.get(dialog);
    dialog.classList.remove('active');
    dialog.setAttribute('aria-hidden', 'true');
    if (state?.previousFocus instanceof HTMLElement) {
        state.previousFocus.focus({ preventScroll: true });
        state.previousFocus = null;
    }
}

export function showToast(message, type = '', action = null) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.replaceChildren();
    toast.append(document.createTextNode(String(message ?? '')));
    if (action?.label && typeof action.onClick === 'function') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toast-action';
        button.textContent = action.label;
        button.setAttribute('aria-label', action.label);
        button.addEventListener('click', () => {
            toast.classList.remove('show');
            action.onClick();
        });
        toast.append(button);
    }
    toast.className = `toast show ${type}`;
    announce(message);
    toastTimer = setTimeout(() => toast.classList.remove('show'), action ? 6000 : 3000);
}

export function showWarningToast(warnings = []) {
    const warning = warnings.find(item => item.severity === 'error' || item.severity === 'warning');
    if (!warning) return;
    // Share the tracked toast timer so a toast shown afterwards cancels the
    // pending warning instead of being clobbered 3200ms later.
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => showToast(
        warning.message,
        warning.severity === 'error' ? 'error' : 'warning'
    ), 3200);
}

export function reportError(context, error, userMessage) {
    console.error(`${context}:`, error);
    showToast(userMessage || error?.message || 'Something went wrong', 'error');
}
