/*
 * FlowZero Main World Interceptor
 * Intercepts native Google Flow download actions (1K/2K/4K menu items, <a download> clicks)
 * Protects blob: URLs from immediate revocation.
 */

(() => {
  if (window.__flowZeroInterceptorInjected) return;
  window.__flowZeroInterceptorInjected = true;

  const NATIVE_CLICK = HTMLElement.prototype.click;
  const NATIVE_REVOKE = URL.revokeObjectURL;
  const pendingBlobUrls = new Set();

  // Override URL.revokeObjectURL to delay revocation of intercepted download blobs
  URL.revokeObjectURL = function(url) {
    if (typeof url === "string" && pendingBlobUrls.has(url)) {
      setTimeout(() => {
        pendingBlobUrls.delete(url);
        try { NATIVE_REVOKE.call(URL, url); } catch (_) {}
      }, 15000);
      return;
    }
    return NATIVE_REVOKE.apply(this, arguments);
  };

  function getAnchorElement(el) {
    if (!el) return null;
    if (el instanceof HTMLAnchorElement) return el;
    return el.closest ? el.closest("a") : null;
  }

  function isDownloadAnchor(el) {
    const a = getAnchorElement(el);
    if (!a || !(a instanceof HTMLAnchorElement)) return false;
    if (a.hasAttribute("data-flowzero-passthrough")) return false;
    
    const hasDownload = a.hasAttribute("download");
    const href = a.href || "";
    const isImage = /\.(png|jpe?g|webp)(\?.*)?$/i.test(href) || 
                    href.startsWith("blob:") || 
                    href.includes("googleusercontent.com") || 
                    href.includes("labs.google");

    return hasDownload || isImage;
  }

  function handleIntercept(el) {
    const a = getAnchorElement(el);
    if (!a) return;
    const href = a.href;
    const filename = a.getAttribute("download") || a.download || `flowzero_${Date.now()}.png`;

    console.log("[FlowZero Interceptor] Intercepted native download:", href);

    if (href.startsWith("blob:")) {
      pendingBlobUrls.add(href);
    }

    // Immediately initiate fetch in Main World before Google Flow attempts to revoke
    fetch(href)
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.blob();
      })
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          window.postMessage({
            type: "FLOWZERO_INTERCEPT_DOWNLOAD",
            dataUrl: reader.result,
            url: href,
            filename: filename
          }, "*");
        };
        reader.readAsDataURL(blob);
      })
      .catch((err) => {
        console.warn("[FlowZero Interceptor] Main world blob fetch warning:", err.message);
        window.postMessage({
          type: "FLOWZERO_INTERCEPT_DOWNLOAD",
          url: href,
          filename: filename
        }, "*");
      });
  }

  // Intercept programmatic .click() calls from Google Flow scripts (e.g. 1K/2K/4K menu downloads)
  HTMLElement.prototype.click = function() {
    try {
      if (isDownloadAnchor(this)) {
        handleIntercept(this);
        return; // Prevent original watermarked download
      }
    } catch (err) {
      console.warn("[FlowZero Interceptor Error]:", err);
    }
    return NATIVE_CLICK.apply(this, arguments);
  };

  // Intercept user click events on <a> elements in capture phase
  document.addEventListener("click", (e) => {
    try {
      const target = e.composedPath && e.composedPath()[0] || e.target;
      const a = target?.closest?.("a[download]");
      if (a && isDownloadAnchor(a)) {
        e.preventDefault();
        e.stopPropagation();
        handleIntercept(a);
      }
    } catch (err) {
      console.warn("[FlowZero Interceptor Event Error]:", err);
    }
  }, true);

  console.log("[FlowZero] Main World Interceptor active with Blob protection.");
})();
