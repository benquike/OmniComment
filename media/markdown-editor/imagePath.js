const schemeReg = /^[a-z][a-z0-9+.-]*:/i;

function isWorkspaceAbsoluteImagePath(src) {
    return typeof src === 'string' && src.startsWith('/') && !src.startsWith('//') && !schemeReg.test(src);
}

function resolveWorkspaceImagePath(src, workspaceBaseUrl) {
    const base = workspaceBaseUrl.replace(/\/$/, '');
    return `${base}${src}`;
}

function rewriteWorkspaceAbsoluteImages(root, workspaceBaseUrl) {
    if (!workspaceBaseUrl || !root) return;
    const rewrite = (img) => {
        const src = img.getAttribute('src');
        if (isWorkspaceAbsoluteImagePath(src)) {
            img.dataset.workspaceAbsoluteSrc = src;
            img.setAttribute('src', resolveWorkspaceImagePath(src, workspaceBaseUrl));
        } else if (img.dataset.workspaceAbsoluteSrc &&
            src !== resolveWorkspaceImagePath(img.dataset.workspaceAbsoluteSrc, workspaceBaseUrl)) {
            delete img.dataset.workspaceAbsoluteSrc;
        }
    };
    if (root instanceof HTMLImageElement) {
        rewrite(root);
    }
    root.querySelectorAll?.('img[src]').forEach(rewrite);
}

export function observeWorkspaceAbsoluteImages(root, workspaceBaseUrl) {
    rewriteWorkspaceAbsoluteImages(root, workspaceBaseUrl);
    if (!workspaceBaseUrl || !root) return;
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.target instanceof HTMLImageElement) {
                rewriteWorkspaceAbsoluteImages(mutation.target, workspaceBaseUrl);
                continue;
            }
            for (const node of mutation.addedNodes) {
                if (node instanceof Element) {
                    rewriteWorkspaceAbsoluteImages(node, workspaceBaseUrl);
                }
            }
        }
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
}

export function restoreWorkspaceBaseUrls(markdown, workspaceBaseUrl) {
    if (typeof markdown !== 'string') return markdown;
    const restored = workspaceBaseUrl
        ? markdown.split(workspaceBaseUrl.replace(/\/$/, '')).join('')
        : markdown;
    return typeof window.__markcoSyncMarkdownBlock === 'function'
        ? window.__markcoSyncMarkdownBlock(restored)
        : restored;
}

export function readMarkdownWithOriginalImagePaths(editor, root, workspaceBaseUrl) {
    const rewrittenImages = Array.from(root?.querySelectorAll?.('img[data-workspace-absolute-src]') ?? []);
    const markcoZoneEls = Array.from(root?.querySelectorAll?.('[data-markco-zone], [data-markco-comments]') ?? []);
    const savedMarkcoAttrs = markcoZoneEls.map(el => ({
        el,
        zone: el.getAttribute('data-markco-zone'),
        comments: el.getAttribute('data-markco-comments'),
    }));
    try {
        for (const img of rewrittenImages) {
            img.setAttribute('src', img.dataset.workspaceAbsoluteSrc);
        }
        for (const item of savedMarkcoAttrs) {
            item.el.removeAttribute('data-markco-zone');
            item.el.removeAttribute('data-markco-comments');
        }
        return restoreWorkspaceBaseUrls(editor?.getValue(), workspaceBaseUrl);
    } finally {
        rewriteWorkspaceAbsoluteImages(root, workspaceBaseUrl);
        for (const item of savedMarkcoAttrs) {
            if (item.zone !== null) item.el.setAttribute('data-markco-zone', item.zone);
            if (item.comments !== null) item.el.setAttribute('data-markco-comments', item.comments);
        }
    }
}

export function createMarkdownValueReader(getEditor, workspaceBaseUrl) {
    return () => readMarkdownWithOriginalImagePaths(
        getEditor?.(),
        document.getElementById('vditor'),
        workspaceBaseUrl,
    );
}
