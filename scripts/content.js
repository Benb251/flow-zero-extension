/*
 * FlowZero Content Script - Google Flow UI Injector
 * Injects "FlowZero" download buttons with 1K, 2K, 4K (Ultra) quality menu on Google Flow images.
 */

(() => {
  const WRAPPER_CLASS = "flowzero-btn-wrapper";
  const PROCESSED_ATTR = "data-flowzero-injected";

  let isExtensionEnabled = false;
  let userFlowTier = "FREE";

  function forwardStateToInterceptor(enabled) {
    const origin = window.location.origin && window.location.origin !== "null" ? window.location.origin : "*";
    window.postMessage({ type: "FLOWZERO_STATE_CHANGE", enabled }, origin);
  }

  // Startup state bootstrap at document_start: query storage and notify MAIN interceptor immediately
  chrome.storage.local.get(["flowzero_enabled", "flowzero_detected_tier"], (res) => {
    isExtensionEnabled = res.flowzero_enabled !== false;
    if (res.flowzero_detected_tier) {
      userFlowTier = res.flowzero_detected_tier;
    }
    forwardStateToInterceptor(isExtensionEnabled);
    if (document.readyState !== "loading") {
      updateButtonsVisibility();
      if (isExtensionEnabled) scanAndInject();
    }
  });

  // Listen for storage toggle updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.flowzero_enabled !== undefined) {
      isExtensionEnabled = changes.flowzero_enabled.newValue !== false;
      forwardStateToInterceptor(isExtensionEnabled);
      updateButtonsVisibility();
      if (isExtensionEnabled) scanAndInject();
    }
  });

  // Listen for tier detection & intercepted downloads from Main World Interceptor
  window.addEventListener("message", async (event) => {
    if (event.source !== window || !event.data) return;
    const targetOrigin = window.location.origin && window.location.origin !== "null" ? window.location.origin : "*";
    if (targetOrigin !== "*" && event.origin !== targetOrigin) return;

    if (event.data.type === "FLOWZERO_TIER_DETECTED" && typeof event.data.tier === "string") {
      userFlowTier = event.data.tier;
      console.log("[FlowZero] Content received tier:", userFlowTier);
      chrome.storage.local.set({ flowzero_detected_tier: userFlowTier });
      updateButtonsVisibility();
      return;
    }

    if (event.data.type === "FLOWZERO_INTERCEPT_DOWNLOAD") {
      const { dataUrl: preloadedDataUrl, url, filename, mediaType } = event.data;
      if (url && typeof url !== "string") return;
      if (preloadedDataUrl && typeof preloadedDataUrl !== "string") return;
      if (!preloadedDataUrl && !url) return;

      if (!isExtensionEnabled) {
        // Just download directly without processing
        const a = document.createElement("a");
        a.href = url || preloadedDataUrl;
        a.download = filename || "download";
        a.setAttribute("data-flowzero-passthrough", "true");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }

      let isVideo = mediaType === "video" || (typeof filename === "string" && filename.toLowerCase().endsWith(".mp4"));
      if (preloadedDataUrl && preloadedDataUrl.startsWith("data:video/")) isVideo = true;
      if (preloadedDataUrl && preloadedDataUrl.startsWith("data:application/mp4")) isVideo = true;
      if (window._flowZeroPendingVideo) isVideo = true;
      window._flowZeroPendingVideo = false;

      const taskId = "task_" + Date.now();

      if (isVideo) {
        showToast("Đang chuẩn bị xử lý video WebCodecs...", "info", 0, 5);
      } else {
        showToast("Đang tự động xóa watermark...", "info", 3500);
      }

      try {
        let dataUrl = preloadedDataUrl;
        if (!isVideo && !dataUrl && url) {
          dataUrl = await urlToDataUrl(url);
          if (!dataUrl) throw new Error("Không thể chuyển đổi dữ liệu từ liên kết");
        }

        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              action: isVideo ? "removeVideoWatermarkAndDownload" : "removeWatermarkAndDownload",
              imageUrl: !isVideo ? dataUrl : undefined,
              videoUrl: isVideo ? preloadedDataUrl : undefined,
              mediaUrl: url || undefined,
              mediaType: isVideo ? "video" : "image",
              taskId,
              filename: filename || (isVideo ? `flowzero_${Date.now()}.mp4` : `flowzero_${Date.now()}.png`)
            },
            (res) => resolve(res || { success: false })
          );
        });

        if (response && response.success) {
          const statsMsg = response.stats ? ` (${response.stats.frames} frames, ${(response.stats.totalMs / 1000).toFixed(1)}s)` : "";
          showToast(
            response.cleaned
              ? `Đã xóa watermark & lưu ${isVideo ? "video" : "ảnh"} thành công!${statsMsg}`
              : `Đã tải ${isVideo ? "video" : "ảnh"} thành công!`,
            "success",
            4000
          );
        } else {
          showToast("Lỗi khi xóa watermark: " + (response?.error || "Không thành công"), "error", 4000);
        }
      } catch (err) {
        console.error("[FlowZero Content Message Error]:", err);
        showToast("Lỗi xử lý tải: " + err.message, "error", 4000);
      }
    }
  });

  // Inject modern CSS styles for FlowZero UI elements & hover quality menu
  function injectStyles() {
    if (document.getElementById("flowzero-styles")) return;

    const style = document.createElement("style");
    style.id = "flowzero-styles";
    style.textContent = `
      .${WRAPPER_CLASS} {
        position: absolute;
        bottom: 10px;
        right: 10px;
        z-index: 99999;
        display: inline-flex;
        flex-direction: column;
        align-items: flex-end;
        user-select: none;
        padding-top: 10px;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s ease, visibility 0.2s ease;
      }

      .flowzero-container:hover .${WRAPPER_CLASS},
      .${WRAPPER_CLASS}.is-hovered {
        opacity: 1;
        visibility: visible;
      }

      .flowzero-hidden {
        display: none !important;
      }

      .flowzero-main-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        background: transparent;
        border: none;
        cursor: pointer;
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s ease;
      }

      .flowzero-main-btn:hover,
      .${WRAPPER_CLASS}.is-hovered .flowzero-main-btn {
        transform: translateY(-1px) scale(1.1);
        filter: drop-shadow(0 4px 10px rgba(168, 85, 247, 0.6));
      }

      .flowzero-main-btn:active {
        transform: translateY(0) scale(0.95);
      }

      .flowzero-main-btn .flowzero-logo-icon {
        width: 32px;
        height: 32px;
        object-fit: contain;
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
      }

      .flowzero-main-btn:hover .flowzero-logo-icon,
      .${WRAPPER_CLASS}.is-hovered .flowzero-logo-icon {
        transform: scale(1.1);
      }

      .flowzero-main-btn.is-loading {
        pointer-events: none;
      }

      .flowzero-main-btn.is-loading .flowzero-logo-icon {
        opacity: 0.7;
        animation: flowzero-spin 1s linear infinite;
      }

      @keyframes flowzero-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .flowzero-dropdown-menu {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 0;
        width: 60px;
        background: rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(24px) saturate(1.5);
        -webkit-backdrop-filter: blur(24px) saturate(1.5);
        border: none;
        border-radius: 12px;
        padding: 6px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
        opacity: 0;
        visibility: hidden;
        transform: translateY(6px) scale(0.96);
        transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.2s;
        pointer-events: none;
        display: flex;
        flex-direction: column;
      }

      .flowzero-dropdown-menu::after {
        content: "";
        position: absolute;
        bottom: -16px;
        left: 0;
        right: 0;
        height: 20px;
        background: transparent;
        pointer-events: auto;
      }

      .${WRAPPER_CLASS}:hover .flowzero-dropdown-menu,
      .${WRAPPER_CLASS}.is-hovered .flowzero-dropdown-menu,
      .flowzero-dropdown-menu:hover {
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }

      .flowzero-menu-item {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        padding: 8px 4px;
        background: transparent;
        border: none;
        border-radius: 8px;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
        text-align: center;
        transition: all 0.2s ease;
        text-shadow: 0 1px 3px rgba(0,0,0,0.2);
        white-space: nowrap;
      }

      .flowzero-menu-item:hover {
        background: rgba(255, 255, 255, 0.25);
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }

      .flowzero-menu-item:active {
        transform: scale(0.95);
        background: rgba(255, 255, 255, 0.35);
      }

      .flowzero-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        z-index: 999999;
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 12px;
        padding: 10px 16px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
        color: #f8fafc;
        font-size: 13px;
        font-weight: 500;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease, transform 0.3s ease;
      }

      .flowzero-toast-content {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .flowzero-toast-bar {
        width: 100%;
        height: 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        overflow: hidden;
      }

      .flowzero-toast-fill {
        height: 100%;
        background: linear-gradient(90deg, #a855f7, #ec4899);
        transition: width 0.2s ease;
      }
    `;
    document.head.appendChild(style);
  }

  let toastHideTimer = null;

  // Safe Toast Notification with DOM textContent and translateX(-50%) centering
  function showToast(message, type = "info", duration = 3200, percent = null) {
    let toast = document.querySelector(".flowzero-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "flowzero-toast";
      document.body.appendChild(toast);
    }

    if (toastHideTimer) {
      clearTimeout(toastHideTimer);
      toastHideTimer = null;
    }

    toast.style.opacity = "1";
    toast.style.transform = "translateX(-50%) translateY(0)";

    const iconColor = type === "success" ? "#22c55e" : type === "error" ? "#ef4444" : type === "warning" ? "#f59e0b" : "#a855f7";
    const iconSvg = type === "success" ? '<polyline points="20 6 9 17 4 12"></polyline>' :
      type === "error" ? '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>' :
      type === "warning" ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>' :
      '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>';

    toast.textContent = "";

    const contentDiv = document.createElement("div");
    contentDiv.className = "flowzero-toast-content";
    contentDiv.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${iconSvg}</svg>`;

    const textSpan = document.createElement("span");
    textSpan.textContent = String(message || "");
    contentDiv.appendChild(textSpan);

    toast.appendChild(contentDiv);

    if (typeof percent === "number") {
      const barDiv = document.createElement("div");
      barDiv.className = "flowzero-toast-bar";
      const fillDiv = document.createElement("div");
      fillDiv.className = "flowzero-toast-fill";
      fillDiv.style.width = `${Math.min(100, Math.max(0, percent))}%`;
      barDiv.appendChild(fillDiv);
      toast.appendChild(barDiv);
    }

    if (duration > 0) {
      toastHideTimer = setTimeout(() => {
        toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
        toast.style.opacity = "0";
        toast.style.transform = "translateX(-50%) translateY(10px)";
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
  }

  // Split Google CDN size suffix (=s..., =w..., =...)
  function _splitCdnSizeSuffix(url) {
    const s = String(url || "");
    const qi = s.indexOf("?");
    const path = qi < 0 ? s : s.slice(0, qi);
    const query = qi < 0 ? "" : s.slice(qi);
    if (!/googleusercontent\.com|storage\.googleapis\.com|lh\d+\.google/i.test(s) || !/=[^/?]*$/.test(path)) {
      return { path, query, stripped: false };
    }
    return { path: path.replace(/=[^/]*$/, ""), query, stripped: true };
  }

  // Convert Google Flow Image CDN URL to target resolution (1K: 1024px, 2K: 2048px, 4K: 4096px)
  function applyResolutionToUrl(url, resolution) {
    if (!url || resolution === "original") return url;
    const resLower = String(resolution || "").toLowerCase();
    const targetWidth = resLower === "2k" ? 2048 : resLower === "4k" ? 4096 : 1024;

    try {
      if (/googleusercontent\.com|storage\.googleapis\.com|lh\d+\.google/i.test(url)) {
        const { path, query, stripped } = _splitCdnSizeSuffix(url);
        return `${path}=w${targetWidth}${query}`;
      }
      const urlObj = new URL(url, window.location.origin);
      if (urlObj.searchParams.has("w") || urlObj.searchParams.has("width") || urlObj.searchParams.has("sz") || urlObj.searchParams.has("s")) {
        if (urlObj.searchParams.has("w")) urlObj.searchParams.set("w", targetWidth.toString());
        if (urlObj.searchParams.has("width")) urlObj.searchParams.set("width", targetWidth.toString());
        if (urlObj.searchParams.has("sz")) urlObj.searchParams.set("sz", targetWidth.toString());
        if (urlObj.searchParams.has("s")) urlObj.searchParams.set("s", targetWidth.toString());
        return urlObj.toString();
      }
      return url;
    } catch (e) {
      console.warn("[FlowZero] URL resolution transform error:", e);
      return url;
    }
  }

  // Extract best image URL from image container
  function getImageUrl(container) {
    if (!container) return null;

    const nearbyDownload = container.querySelector("a[download]") ||
                           container.closest(".modal, [role='dialog'], .tile, [data-tile-id]")?.querySelector("a[download]");
    if (nearbyDownload && nearbyDownload.href) {
      return nearbyDownload.href;
    }

    const scope = container.closest(".modal, [role='dialog'], .tile, [data-tile-id], [data-test-id='media-tile']") || container;
    const video = scope.querySelector("video");
    if (video) return video.currentSrc || video.src;

    if (container.tagName === "IMG" && container.src && !container.classList.contains("flowzero-logo-icon")) {
      return container.currentSrc || container.src;
    }
    const img = Array.from(scope.querySelectorAll("img")).find(i => !i.classList.contains("flowzero-logo-icon"));
    if (img) return img.currentSrc || img.src;

    const bgImage = window.getComputedStyle(container).backgroundImage;
    if (bgImage && bgImage !== "none") {
      const match = bgImage.match(/url\(["']?(.*?)["']?\)/);
      if (match && match[1]) return match[1];
    }

    return null;
  }

  // Convert URL to DataURL and upgrade resolution (1K: 1024px, 2K: 2048px, 4K: 4096px)
  async function urlToDataUrl(url, resolution = "1k") {
    if (!url) return null;
    if (url.startsWith("data:")) return url;

    const resKey = (resolution || "1k").toLowerCase();

    try {
      let targetUrl = applyResolutionToUrl(url, resKey);

      let resp;
      try {
        resp = await fetch(targetUrl, { cache: "no-store" });
      } catch (_) {
        resp = await fetch(targetUrl, { credentials: "include", cache: "no-store" });
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const redirectedUrl = resp.url || "";
      if (redirectedUrl && /googleusercontent\.com|storage\.googleapis\.com|lh\d+\.google/i.test(redirectedUrl)) {
        const highResCdnUrl = applyResolutionToUrl(redirectedUrl, resKey);
        if (highResCdnUrl && highResCdnUrl !== redirectedUrl) {
          try {
            let highResResp;
            try {
              highResResp = await fetch(highResCdnUrl, { cache: "no-store" });
            } catch (_) {
              highResResp = await fetch(highResCdnUrl, { credentials: "include", cache: "no-store" });
            }
            if (highResResp && highResResp.ok) {
              resp = highResResp;
            }
          } catch (err) {
            console.warn("[FlowZero] Could not fetch upgraded CDN stream, using base response:", err.message);
          }
        }
      }

      const blob = await resp.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("FileReader failed to convert blob"));
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn("[FlowZero] Direct fetch fallback:", err.message);
      return url;
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function triggerFlowNativeDownload(container, resolution = "2k") {
    const resUpper = resolution.toUpperCase();
    console.log("[FlowZero] Requested native resolution:", resUpper);

    const imgEl = container.querySelector("img") || container.querySelector("video") || container;
    if (!imgEl) return false;

    imgEl.scrollIntoView({ behavior: "instant", block: "center" });
    await sleep(100);

    const rect = imgEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    imgEl.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      button: 2
    }));

    let contextMenu = null;
    for (let i = 0; i < 15; i++) {
      await sleep(120);
      const menus = document.querySelectorAll('[role="menu"], [data-radix-menu-content], [aria-label*="menu" i], .context-menu');
      for (const m of menus) {
        if (m.offsetWidth > 0 && m.offsetHeight > 0) {
          contextMenu = m;
          break;
        }
      }
      if (contextMenu) break;
    }

    if (!contextMenu) {
      console.warn("[FlowZero] Context menu did not appear.");
      return false;
    }
    await sleep(100);

    const menuItems = contextMenu.querySelectorAll('[role="menuitem"], button, div[tabindex]');
    let downloadItem = null;

    for (const item of menuItems) {
      const text = item.textContent?.toLowerCase() || "";
      if (text.includes("download") || text.includes("tải xuống") || text.includes("tải về")) {
        downloadItem = item;
        break;
      }
    }

    if (!downloadItem) {
      console.warn("[FlowZero] Download menu item not found in context menu.");
      return false;
    }

    const dlRect = downloadItem.getBoundingClientRect();
    const dlCx = dlRect.left + dlRect.width / 2;
    const dlCy = dlRect.top + dlRect.height / 2;

    const pointerOpts = { bubbles: true, cancelable: true, clientX: dlCx, clientY: dlCy, pointerId: 1, pointerType: "mouse" };
    downloadItem.dispatchEvent(new PointerEvent("pointerover", pointerOpts));
    downloadItem.dispatchEvent(new PointerEvent("pointerenter", pointerOpts));
    downloadItem.dispatchEvent(new PointerEvent("pointermove", pointerOpts));
    downloadItem.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: dlCx, clientY: dlCy }));
    downloadItem.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX: dlCx, clientY: dlCy }));
    downloadItem.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: dlCx, clientY: dlCy }));

    let subMenu = null;
    for (let i = 0; i < 15; i++) {
      await sleep(120);
      const allMenus = document.querySelectorAll('[role="menu"], [data-radix-menu-content], .submenu');
      for (const m of allMenus) {
        if (m !== contextMenu && m.offsetWidth > 0 && m.offsetHeight > 0) {
          subMenu = m;
          break;
        }
      }
      if (subMenu) break;
    }

    if (!subMenu) {
      downloadItem.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
      downloadItem.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
      await sleep(150);
      const allMenus = document.querySelectorAll('[role="menu"], [data-radix-menu-content], .submenu');
      for (const m of allMenus) {
        if (m !== contextMenu && m.offsetWidth > 0 && m.offsetHeight > 0) {
          subMenu = m;
          break;
        }
      }
    }

    if (!subMenu) {
      console.warn("[FlowZero] Resolution submenu not found.");
      return false;
    }

    console.log("[FlowZero] Resolution submenu found");
    await sleep(150);

    let subItems = subMenu.querySelectorAll('[role="menuitem"]');
    if (!subItems || subItems.length === 0) {
      subItems = subMenu.querySelectorAll('button, div[tabindex]');
    }

    let targetSubItem = null;

    for (const item of subItems) {
      const rawText = item.textContent || "";
      const normalized = rawText.replace(/\s+/g, " ").trim().toUpperCase();

      if (normalized.startsWith(resUpper)) {
        if (item.getAttribute("aria-disabled") === "true" || item.hasAttribute("disabled")) {
          console.warn(`[FlowZero] Option ${resUpper} is disabled in Flow.`);
          showToast(`Tùy chọn ${resUpper} không khả dụng cho tài khoản hiện tại`, "warning", 3500);
          return false;
        }
        targetSubItem = item;
        break;
      }
    }

    if (!targetSubItem) {
      console.warn(`[FlowZero] Submenu item for ${resUpper} not found. Available items:`, Array.from(subItems).map(i => i.textContent?.replace(/\s+/g, " ").trim()));
      return false;
    }

    const clickedText = targetSubItem.textContent?.replace(/\s+/g, " ").trim().toUpperCase();
    console.log("[FlowZero] Clicking native resolution:", clickedText);
    targetSubItem.click();
    return true;
  }

  async function executeDownload(btn, targetContainer, quality = "1k") {
    const resKey = quality === "auto" ? "1k" : quality.toLowerCase();
    const rawUrl = getImageUrl(targetContainer);
    if (!rawUrl) {
      showToast("Khởi tạo thất bại: Không tìm thấy liên kết", "error");
      return;
    }

    btn.classList.add("is-loading");
    try {
      const isVideoBtn = resKey === "720p" || resKey === "1080p";
      const isVideo = isVideoBtn || (rawUrl && rawUrl.includes(".mp4"));

      if (["2k", "4k", "720p", "1080p"].includes(resKey)) {
        if (isVideo) window._flowZeroPendingVideo = true;
        const menuTriggered = await triggerFlowNativeDownload(targetContainer, resKey);
        if (menuTriggered) {
          setTimeout(() => btn.classList.remove("is-loading"), 3000);
          return;
        }
        window._flowZeroPendingVideo = false;
      }

      const ext = isVideo ? "mp4" : "png";
      const filename = `flowzero_${resKey}_${Date.now()}.${ext}`;
      
      let dataUrl = undefined;
      let mediaUrl = undefined;

      if (isVideo) {
        if (rawUrl.startsWith("blob:")) {
          dataUrl = await urlToDataUrl(rawUrl, "original");
          mediaUrl = rawUrl;
        } else {
          mediaUrl = rawUrl;
        }
      } else {
        dataUrl = await urlToDataUrl(rawUrl, resKey);
        mediaUrl = rawUrl;
      }

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: isVideo ? "removeVideoWatermarkAndDownload" : "removeWatermarkAndDownload",
            imageUrl: !isVideo ? dataUrl : undefined,
            videoUrl: isVideo ? dataUrl : undefined,
            mediaUrl: mediaUrl,
            filename,
            resolution: resKey
          },
          (res) => resolve(res || { success: false })
        );
      });

      btn.classList.remove("is-loading");
      if (response?.success) {
        showToast("Đã xử lý thành công!", "success");
      } else {
        throw new Error(response?.error || "Lỗi xử lý");
      }
    } catch (err) {
      btn.classList.remove("is-loading");
      showToast(`Lỗi: ${err.message}`, "error");
    }
  }

  function updateButtonsVisibility() {
    const wrappers = document.querySelectorAll(`.${WRAPPER_CLASS}`);
    const isUltra = userFlowTier.includes("PAYGATE_TIER_") && 
                    !userFlowTier.includes("NOT_PAID") && 
                    !userFlowTier.includes("PAYGATE_TIER_ONE");

    wrappers.forEach((w) => {
      w.classList.toggle("flowzero-hidden", !isExtensionEnabled);
      const btn4k = w.querySelector('.flowzero-menu-item[data-quality="4k"]');
      if (btn4k) {
        if (isUltra) {
          btn4k.classList.remove("flowzero-hidden");
        } else {
          btn4k.classList.add("flowzero-hidden");
        }
      }
    });
  }

  function injectButtonInto(container) {
    if (container.tagName === "IMG") container = container.parentElement;
    if (!container || container.hasAttribute(PROCESSED_ATTR)) return;
    container.setAttribute(PROCESSED_ATTR, "true");

    if (window.getComputedStyle(container).position === "static") container.style.position = "relative";
    container.classList.add("flowzero-container");

    const wrapper = document.createElement("div");
    wrapper.className = WRAPPER_CLASS;
    wrapper.innerHTML = `
      <div class="flowzero-dropdown-menu">
        <button class="flowzero-menu-item" data-quality="1k">1K</button>
        <button class="flowzero-menu-item" data-quality="2k">2K</button>
        <button class="flowzero-menu-item" data-quality="4k">4K</button>
        <div style="height: 1px; background: rgba(255,255,255,0.2); margin: 4px 2px;"></div>
        <button class="flowzero-menu-item" data-quality="720p">720p</button>
        <button class="flowzero-menu-item" data-quality="1080p">1080p</button>
      </div>
      <button class="flowzero-main-btn" title="Tải hình ảnh/video không watermark">
        <img class="flowzero-logo-icon" src="${chrome.runtime.getURL('assets/icon128.png')}" alt="FlowZero" />
      </button>
    `;

    const mainBtn = wrapper.querySelector(".flowzero-main-btn");
    mainBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); executeDownload(mainBtn, container, "auto"); });
    wrapper.querySelectorAll(".flowzero-menu-item").forEach(item => {
      item.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); executeDownload(mainBtn, container, item.getAttribute("data-quality")); });
    });

    let hoverTimer = null;
    wrapper.addEventListener("mouseenter", () => { if(hoverTimer) clearTimeout(hoverTimer); wrapper.classList.add("is-hovered"); });
    wrapper.addEventListener("mouseleave", () => { hoverTimer = setTimeout(() => wrapper.classList.remove("is-hovered"), 350); });
    container.appendChild(wrapper);

    updateButtonsVisibility();
  }

  function scanAndInject() {
    if (!isExtensionEnabled) return;
    document.querySelectorAll(".tile-image-container, [data-test-id='media-tile'], [data-tile-id]").forEach(el => {
      const container = el.tagName === "IMG" ? (el.parentElement || el) : el;
      if (container.offsetWidth > 80 && container.offsetHeight > 80) injectButtonInto(container);
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.target === "content" && message.action === "videoProgress" && message.progress) {
      showToast(message.progress.phase === "finalizing" ? "Đóng gói..." : `Đang xử lý (${message.progress.percent}%)`, "info", 0, message.progress.percent);
    }
  });

  function init() {
    injectStyles();
    updateButtonsVisibility();
    if (isExtensionEnabled) scanAndInject();

    let scanScheduled = false;
    const observer = new MutationObserver((mutations) => {
      if (!isExtensionEnabled || scanScheduled) return;

      let hasRelevantNodes = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) {
              hasRelevantNodes = true;
              break;
            }
          }
        }
        if (hasRelevantNodes) break;
      }

      if (hasRelevantNodes) {
        scanScheduled = true;
        requestAnimationFrame(() => {
          scanScheduled = false;
          scanAndInject();
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
