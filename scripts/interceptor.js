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
    const isMedia = /\.(png|jpe?g|webp|mp4|webm)(\?.*)?$/i.test(href) || 
                    href.startsWith("blob:") || 
                    href.includes("googleusercontent.com") || 
                    href.includes("flow-content.google") || 
                    href.includes("labs.google");

    return hasDownload || isMedia;
  }

  function handleIntercept(el) {
    const a = getAnchorElement(el);
    if (!a) return;
    const href = a.href;
    // Check if the <a> tag's ancestors contain video markers
    const root = a.closest(".modal, [role='dialog'], .tile, [data-tile-id], [data-test-id='media-tile']") || a.parentElement?.parentElement?.parentElement || a;
    let hasVideoMarker = false;
    if (root && root !== document.body) {
      if (root.querySelector("video") !== null) hasVideoMarker = true;
      const txt = root.textContent.toLowerCase().normalize("NFC");
      if (txt.includes("play_circle") || txt.includes("chuyển động") || txt.includes("motion") || txt.includes("video")) hasVideoMarker = true;
      const icons = root.querySelectorAll("i");
      for (const icon of icons) {
        if (icon.textContent.toLowerCase().includes("play")) hasVideoMarker = true;
      }
      const svgs = root.querySelectorAll("svg");
      for (const svg of svgs) {
        const aria = (svg.getAttribute("aria-label") || "").toLowerCase().normalize("NFC");
        if (aria.includes("play") || aria.includes("video") || aria.includes("motion")) hasVideoMarker = true;
      }
    }

    const isVideo = /\.(mp4|webm)(\?.*)?$/i.test(href) || hasVideoMarker;
    const defaultExt = isVideo ? ".mp4" : ".png";
    const filename = a.getAttribute("download") || a.download || `flowzero_${Date.now()}${defaultExt}`;

    console.log("[FlowZero Interceptor] Intercepted native download:", href, "isVideo:", isVideo);

    if (href.startsWith("blob:")) {
      pendingBlobUrls.add(href);

      fetch(href)
        .then(res => res.blob())
        .then(blob => {
          let isMp4 = false;
          if (blob.type.startsWith("video/") || blob.type === "application/mp4") isMp4 = true;
          
          const processBlob = (finalIsVideo) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              window.postMessage({
                type: "FLOWZERO_INTERCEPT_DOWNLOAD",
                url: href,
                dataUrl: reader.result,
                filename: a.download || filename,
                mediaType: finalIsVideo ? "video" : "image"
              }, "*");
            };
            reader.readAsDataURL(blob);
          };

          if (!isMp4 && blob.size > 12) {
            const slice = blob.slice(0, 12);
            slice.arrayBuffer().then(buf => {
              const bytes = new Uint8Array(buf);
              if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
                isMp4 = true;
              }
              processBlob(isVideo || isMp4);
            }).catch(() => processBlob(isVideo));
          } else {
            processBlob(isVideo || isMp4);
          }
        })
        .catch((err) => {
          console.warn("[FlowZero Interceptor] Main world blob fetch warning:", err.message);
          window.postMessage({
            type: "FLOWZERO_INTERCEPT_DOWNLOAD",
            url: href,
            filename: filename,
            mediaType: isVideo ? "video" : "image"
          }, "*");
        });
    } else {
      // For non-blob URLs, proceed with standard fetch
      fetch(href)
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.blob();
      })
      .then((blob) => {
        const isBlobVideo = blob.type.startsWith("video/") || isVideo;
        const reader = new FileReader();
        reader.onloadend = () => {
          window.postMessage({
            type: "FLOWZERO_INTERCEPT_DOWNLOAD",
            dataUrl: reader.result,
            url: href,
            filename: filename,
            mediaType: isBlobVideo ? "video" : "image"
          }, "*");
        };
        reader.readAsDataURL(blob);
      })
      .catch((err) => {
        console.warn("[FlowZero Interceptor] Main world blob fetch warning:", err.message);
        window.postMessage({
          type: "FLOWZERO_INTERCEPT_DOWNLOAD",
          url: href,
          filename: filename,
        }, "*");
      });
    }
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

  // Flow Tier Detection (Independent)
  function emitTier(tier) {
    if (!window.__flowZeroTierEmitted) {
      window.__flowZeroTierEmitted = true;
      console.log("[FlowZero] Detected Flow Tier:", tier);
      window.postMessage({ type: "FLOWZERO_TIER_DETECTED", tier: tier }, "*");
    }
  }

  // 1. Scan DOM for Next.js Initial State
  setTimeout(() => {
    try {
      const nextData = document.getElementById("__NEXT_DATA__");
      if (nextData && nextData.textContent) {
        const match = nextData.textContent.match(/PAYGATE_TIER_[A-Z0-9_]+/i);
        if (match) emitTier(match[0]);
      }
    } catch(e) {}
  }, 1000);

  // 2. Intercept Fetch API to catch projectInitialData, session, flowAppConfig, credits etc.
  const _origFetch = window.fetch;
  window.fetch = function(...args) {
    const promise = _origFetch.apply(this, args);
    promise.then((res) => {
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        if (url.includes('/api/trpc/') || url.includes('/api/auth/') || url.includes('/v1/credits')) {
          res.clone().text().then((text) => {
            const match = text.match(/PAYGATE_TIER_[A-Z0-9_]+/i);
            if (match) emitTier(match[0]);
          }).catch(() => {});
        }
      } catch (e) {}
    }).catch(() => {});
    return promise;
  };

})();
