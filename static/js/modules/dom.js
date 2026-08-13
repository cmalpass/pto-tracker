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

export function escapeHtml(value) {
    const node = document.createElement('div');
    node.textContent = String(value ?? '');
    return node.innerHTML;
}

export function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = String(message ?? '');
    toast.className = `toast show ${type}`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

export function showWarningToast(warnings = []) {
    const warning = warnings.find(item => item.severity === 'error' || item.severity === 'warning');
    if (warning) {
        setTimeout(() => showToast(
            warning.message,
            warning.severity === 'error' ? 'error' : 'warning'
        ), 3200);
    }
}

export function reportError(context, error, userMessage) {
    console.error(`${context}:`, error);
    showToast(userMessage || error?.message || 'Something went wrong', 'error');
}
