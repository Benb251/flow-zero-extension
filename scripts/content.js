/*
 * FlowZero Content Script - Google Flow UI Injector
 * Injects "FlowZero" download buttons with 1K, 2K, 4K (Ultra) quality menu on Google Flow images.
 */

(() => {
  const WRAPPER_CLASS = "flowzero-btn-wrapper";
  const PROCESSED_ATTR = "data-flowzero-injected";

  let isExtensionEnabled = true;
  let userFlowTier = "FREE";

  // Listen for tier detection from Main World Interceptor
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === "FLOWZERO_TIER_DETECTED" && event.data.tier) {
      userFlowTier = event.data.tier;
      chrome.storage.local.set({ flowzero_detected_tier: userFlowTier });
      updateButtonsVisibility();
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
        padding-top: 10px; /* Seamless hover bounding area */
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
        padding: 4px; /* Minimal padding */
        background: transparent;
        border: none;
        cursor: pointer;
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s ease;
      }

      .flowzero-main-btn:hover,
      .${WRAPPER_CLASS}.is-hovered .flowzero-main-btn {
        transform: translateY(-1px) scale(1.1);
        filter: drop-shadow(0 4px 10px rgba(168, 85, 247, 0.6)); /* Glow effect directly on the icon shape */
      }

      .flowzero-main-btn:active {
        transform: translateY(0) scale(0.95);
      }

      .flowzero-main-btn .flowzero-logo-icon {
        width: 32px; /* Scaled up to cover the old button area */
        height: 32px;
        object-fit: contain;
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
      }

      .flowzero-main-btn:hover .flowzero-logo-icon,
      .${WRAPPER_CLASS}.is-hovered .flowzero-logo-icon {
        transform: scale(1.1);
      }

      /* Loading & Success States */
      .flowzero-main-btn.is-loading {
        pointer-events: none;
      }

      .flowzero-main-btn.is-loading .flowzero-logo-icon {
        opacity: 0.7;
        animation: flowzero-spin 1s linear infinite;
      }

      .flowzero-main-btn.is-success {
        /* No border changes needed */
      }

      .flowzero-main-btn.is-success .flowzero-logo-icon {
        transform: scale(1.15);
        filter: drop-shadow(0 0 4px rgba(34, 197, 94, 0.6));
      }

      @keyframes flowzero-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      /* Hover Dropdown Menu - Glassmorphism Light Theme */
      .flowzero-dropdown-menu {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 0;
        width: 60px;
        background: rgba(255, 255, 255, 0.15); /* Soft light glass */
        backdrop-filter: blur(24px) saturate(1.5);
        -webkit-backdrop-filter: blur(24px) saturate(1.5);
        border: none;
        border-radius: 12px;
        padding: 6px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
        opacity: 0;
        visibility: hidden;
        transform: translateY(6px) scale(0.96);
        transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                    transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                    visibility 0.2s;
        pointer-events: none;
      }

      /* Invisible bridge to bridge hover area between menu and button */
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

      .flowzero-menu-item.is-locked {
        opacity: 0.7;
        color: rgba(255, 255, 255, 0.7);
        text-shadow: none;
      }

      .flowzero-menu-item.is-locked:hover {
        background: rgba(255, 255, 255, 0.1);
      }

      /* Toast Notification */
      .flowzero-toast {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 100000;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 18px;
        background: rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(24px) saturate(1.5);
        -webkit-backdrop-filter: blur(24px) saturate(1.5);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 12px;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13.5px;
        font-weight: 500;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
        text-shadow: 0 1px 3px rgba(0,0,0,0.2);
        animation: flowzero-toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        min-width: 260px;
        flex-direction: column;
        align-items: flex-start;
      }

      .flowzero-toast-content {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
      }

      .flowzero-toast-bar {
        width: 100%;
        height: 4px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 2px;
        margin-top: 6px;
        overflow: hidden;
      }

      .flowzero-toast-fill {
        height: 100%;
        background: linear-gradient(90deg, #a855f7, #ec4899);
        border-radius: 2px;
        transition: width 0.2s ease;
      }

      @keyframes flowzero-toast-in {
        from { opacity: 0; transform: translateY(12px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
    `;
    document.head.appendChild(style);
  }

  let toastHideTimer = null;

  // Show Toast Notification with optional Progress Bar
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
    toast.style.transform = "translateY(0)";

    const iconColor = type === "success" ? "#22c55e" : type === "error" ? "#ef4444" : type === "warning" ? "#f59e0b" : "#a855f7";
    const progressBar = typeof percent === "number" ? `
      <div class="flowzero-toast-bar">
        <div class="flowzero-toast-fill" style="width: ${Math.min(100, Math.max(0, percent))}%"></div>
      </div>
    ` : "";

    toast.innerHTML = `
      <div class="flowzero-toast-content">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          ${type === "success" ? '<polyline points="20 6 9 17 4 12"></polyline>' :
            type === "error" ? '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>' :
            type === "warning" ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>' :
            '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>'}
        </svg>
        <span>${message}</span>
      </div>
      ${progressBar}
    `;

    if (duration > 0) {
      toastHideTimer = setTimeout(() => {
        toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
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

    // Strictly check for video within the specific container or its closest tile/modal.
    // Do NOT traverse up and querySelector down broadly, as it will capture sibling videos in a grid!
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
      // 1. Initial resolution transformation if URL already matches Google CDN
      let targetUrl = applyResolutionToUrl(url, resKey);

      let resp;
      try {
        resp = await fetch(targetUrl, { cache: "no-store" });
      } catch (_) {
        resp = await fetch(targetUrl, { credentials: "include", cache: "no-store" });
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      // 2. Handle HTTP redirect (e.g. from /fx/api/trpc/media.getMediaUrlRedirect to Google CDN)
      const redirectedUrl = resp.url || "";
      if (redirectedUrl && /googleusercontent\.com|storage\.googleapis\.com|lh\d+\.google/i.test(redirectedUrl)) {
        const highResCdnUrl = applyResolutionToUrl(redirectedUrl, resKey);
        if (highResCdnUrl && highResCdnUrl !== redirectedUrl) {
          console.log(`[FlowZero] Redirect detected -> Upgrading to [${resKey.toUpperCase()}]:`, highResCdnUrl);
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

  // Automate Google Flow's native context menu to trigger true 2K/4K upscale & download
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function triggerFlowNativeDownload(container, resolution = "2k") {
    const resUpper = resolution.toUpperCase();
    console.log(`[FlowZero] Automating native Flow upscale & download for [${resUpper}]...`);

    const imgEl = container.querySelector("img") || container.querySelector("video") || container;
    if (!imgEl) return false;

    imgEl.scrollIntoView({ behavior: "instant", block: "center" });
    await sleep(100);

    const rect = imgEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // 1. Right click on media element
    imgEl.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      button: 2
    }));

    // 2. Wait for Context Menu to appear
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

    // 3. Find "Download" / "Tải xuống" item in context menu
    const menuItems = contextMenu.querySelectorAll('[role="menuitem"], button, div[tabindex]');
    let downloadItem = null;

    for (const item of menuItems) {
      const text = item.textContent?.toLowerCase() || "";
      const hasDownloadText = text.includes("download") || text.includes("tải xuống") || text.includes("tải về");
      const hasAriaMenu = item.getAttribute("aria-haspopup") === "menu" || item.hasAttribute("data-state");

      if (hasDownloadText || (hasAriaMenu && (text.includes("download") || text.includes("tải")))) {
        downloadItem = item;
        break;
      }
    }

    if (!downloadItem) {
      for (const item of menuItems) {
        if (item.getAttribute("aria-haspopup") === "menu") {
          downloadItem = item;
          break;
        }
      }
    }

    if (!downloadItem) {
      console.warn("[FlowZero] Download menu item not found in context menu.");
      return false;
    }

    // 4. Trigger hover / enter on Download item to open submenu
    const dlRect = downloadItem.getBoundingClientRect();
    const dlCx = dlRect.left + dlRect.width / 2;
    const dlCy = dlRect.top + dlRect.height / 2;

    const pointerOpts = { bubbles: true, cancelable: true, clientX: dlCx, clientY: dlCy, pointerId: 1, pointerType: "mouse" };
    const mouseOpts = { bubbles: true, cancelable: true, clientX: dlCx, clientY: dlCy };

    downloadItem.dispatchEvent(new PointerEvent("pointerover", pointerOpts));
    downloadItem.dispatchEvent(new PointerEvent("pointerenter", pointerOpts));
    downloadItem.dispatchEvent(new MouseEvent("mouseover", mouseOpts));
    downloadItem.dispatchEvent(new MouseEvent("mouseenter", mouseOpts));
    await sleep(120);
    downloadItem.dispatchEvent(new PointerEvent("pointerdown", { ...pointerOpts, button: 0 }));
    downloadItem.dispatchEvent(new PointerEvent("pointerup", { ...pointerOpts, button: 0 }));
    downloadItem.click();

    // 5. Wait for Submenu with resolutions (1K, 2K, 4K)
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
      console.warn("[FlowZero] Resolution submenu not found.");
      return false;
    }

    await sleep(150);

    // 6. Find target resolution item (e.g. 2K, 4K, 1K)
    const subItems = subMenu.querySelectorAll('[role="menuitem"], button, div[tabindex]');
    let targetSubItem = null;

    for (const item of subItems) {
      const text = item.textContent?.trim() || "";
      if (text.toUpperCase().startsWith(resUpper) || text.toUpperCase().includes(resUpper)) {
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
      if (window._flowZeroPendingVideo) {
        for (const item of subItems) {
          const t = item.textContent?.toLowerCase() || "";
          if (t.includes("tải") || t.includes("download") || t.includes("lưu") || t.includes("save")) {
            targetSubItem = item;
            break;
          }
        }
      }
      if (!targetSubItem) {
        console.warn(`[FlowZero] Submenu item for ${resUpper} not found. Available:`, Array.from(subItems).map(i => i.textContent?.trim()));
        return false;
      }
    }

    // 7. Click target resolution item to trigger native Flow upscale & download!
    console.log(`[FlowZero] Clicking Flow native [${resUpper}] item:`, targetSubItem.textContent?.trim());
    targetSubItem.click();
    return true;
    return true;
  }

  // Handle Download Action with specified quality
  async function executeDownload(btn, targetContainer, quality = "1k") {
    const resKey = quality === "auto" ? "1k" : quality.toLowerCase();

    const rawUrl = getImageUrl(targetContainer);
    if (!rawUrl) {
      showToast("Khởi tạo thất bại: Không tìm thấy liên kết ảnh", "error");
      return;
    }

    console.log(`[FlowZero] Initiating download [${resKey.toUpperCase()}]:`, rawUrl);

    // Set Loading state
    btn.classList.add("is-loading");
    btn.classList.remove("is-success");
    const labelSpan = btn.querySelector(".flowzero-label");
    const originalText = labelSpan ? labelSpan.textContent : "FlowZero";
    if (labelSpan) labelSpan.textContent = `Xóa WM (${resKey.toUpperCase()})...`;

    try {
      const isVideoBtn = resKey === "720p" || resKey === "1080p";
      const isVideo = isVideoBtn || (rawUrl && rawUrl.includes(".mp4"));

      // If high-res requested, attempt native Flow upscale automation first
      if (resKey === "2k" || resKey === "4k" || resKey === "1080p" || resKey === "720p") {
        showToast(`Đang yêu cầu Google Flow upscale ${resKey.toUpperCase()} & xóa watermark...`, "info", 4000);
        if (isVideo) window._flowZeroPendingVideo = true;
        const menuTriggered = await triggerFlowNativeDownload(targetContainer, resKey);
        if (menuTriggered) {
          // Flow native download will trigger and interceptor.js will capture and clean it!
          setTimeout(() => {
            btn.classList.remove("is-loading");
            if (labelSpan) labelSpan.textContent = originalText;
            window._flowZeroPendingVideo = false;
          }, 3000);
          return;
        }
        window._flowZeroPendingVideo = false;
        console.log("[FlowZero] Menu automation skipped/fallback to direct stream...");
      }

      const ext = isVideo ? "mp4" : "png";
      const action = isVideo ? "removeVideoWatermarkAndDownload" : "removeWatermarkAndDownload";

      const filename = `flowzero_${resKey}_${Date.now()}.${ext}`;
      // For videos, don't attempt image resolution hacks unless we know it works, 
      // but urlToDataUrl with "original" bypasses the image size suffixes.
      const dataUrl = await urlToDataUrl(rawUrl, isVideo ? "original" : resKey);
      if (!dataUrl) throw new Error("Không thể chuyển đổi dữ liệu");

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: action,
            imageUrl: dataUrl,
            filename,
            resolution: resKey
          },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(res || { success: false, error: "Không có phản hồi từ tiện ích" });
            }
          }
        );
      });

      if (!response || !response.success) {
        throw new Error(response?.error || "Lỗi xử lý xóa watermark");
      }

      // Success state
      btn.classList.remove("is-loading");
      btn.classList.add("is-success");
      
      showToast(
        response.cleaned
          ? `Đã xóa watermark & lưu ảnh ${resKey.toUpperCase()} thành công!`
          : `Đã tải hình ảnh ${resKey.toUpperCase()} về máy!`,
        "success"
      );

      setTimeout(() => {
        btn.classList.remove("is-success");
        if (labelSpan) labelSpan.textContent = originalText;
      }, 2500);

    } catch (err) {
      console.error("[FlowZero Content Error]:", err);
      btn.classList.remove("is-loading");
      if (labelSpan) labelSpan.textContent = originalText;
      showToast(`Lỗi: ${err.message || "Tải ảnh thất bại"}`, "error");
    }
  }

  // Update visibility of all injected FlowZero buttons
  function updateButtonsVisibility() {
    const wrappers = document.querySelectorAll(`.${WRAPPER_CLASS}`);
    const isUltra = userFlowTier.includes("PAYGATE_TIER_") && 
                    !userFlowTier.includes("NOT_PAID") && 
                    !userFlowTier.includes("PAYGATE_TIER_ONE");
    wrappers.forEach((w) => {
      if (isExtensionEnabled) {
        w.classList.remove("flowzero-hidden");
      } else {
        w.classList.add("flowzero-hidden");
      }

      const btn4k = w.querySelector('.flowzero-menu-item[data-quality="4k"]');
      if (btn4k) {
        if (isUltra) {
          btn4k.classList.remove("flowzero-hidden");
          btn4k.classList.remove("is-locked");
          btn4k.title = "4K";
        } else {
          btn4k.classList.add("flowzero-hidden");
        }
      }
    });
  }

  // Inject FlowZero button + Hover Quality Menu into image containers
  function injectButtonInto(container) {
    if (container.tagName === "IMG") {
      container = container.parentElement;
    }
    if (!container) return;
    if (container.hasAttribute(PROCESSED_ATTR)) return;
    container.setAttribute(PROCESSED_ATTR, "true");

    const computedStyle = window.getComputedStyle(container);
    if (computedStyle.position === "static") {
      container.style.position = "relative";
    }
    container.classList.add("flowzero-container");

    const wrapper = document.createElement("div");
    wrapper.className = WRAPPER_CLASS;
    if (!isExtensionEnabled) {
      wrapper.classList.add("flowzero-hidden");
    }

    wrapper.innerHTML = `
      <div class="flowzero-dropdown-menu" style="min-width: 110px;">
        <button class="flowzero-menu-item" data-quality="1k">Ảnh 1K</button>
        <button class="flowzero-menu-item" data-quality="2k">Ảnh 2K</button>
        <div style="height: 1px; background: rgba(255,255,255,0.15); margin: 4px 8px;"></div>
        <button class="flowzero-menu-item" data-quality="720p">Video 720p</button>
        <button class="flowzero-menu-item" data-quality="1080p">Video 1080p</button>
      </div>

      <button class="flowzero-main-btn" title="Tải ảnh không có Watermark với FlowZero">
        <img class="flowzero-logo-icon" src="${chrome.runtime.getURL('assets/icon128.png')}" alt="FlowZero" />
      </button>
    `;

    const mainBtn = wrapper.querySelector(".flowzero-main-btn");
    mainBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      executeDownload(mainBtn, container, "auto");
    });

    const menuItems = wrapper.querySelectorAll(".flowzero-menu-item");
    menuItems.forEach((item) => {
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const quality = item.getAttribute("data-quality") || "auto";
        executeDownload(mainBtn, container, quality);
      });
    });

    // Smart Hover Management with Grace Period (prevents abrupt closing)
    let hoverTimer = null;
    wrapper.addEventListener("mouseenter", () => {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      wrapper.classList.add("is-hovered");
    });

    wrapper.addEventListener("mouseleave", () => {
      hoverTimer = setTimeout(() => {
        wrapper.classList.remove("is-hovered");
      }, 350); // 350ms grace period for smooth cursor transitions
    });

    container.appendChild(wrapper);

  }

  // Scan Google Flow DOM for image elements / modal overlays
  function scanAndInject() {
    if (!isExtensionEnabled) return;

    const selectors = [
      ".tile-image-container",
      "[data-test-id='media-tile']",
      "[data-tile-id]"
    ];

    const elements = document.querySelectorAll(selectors.join(", "));
    elements.forEach((el) => {
      const container = el.tagName === "IMG" ? (el.parentElement || el) : el;
      if (container && container.offsetWidth > 80 && container.offsetHeight > 80) {
        injectButtonInto(container);
      }
    });
  }

  // Inject Main World Interceptor Script into Page DOM
  function injectMainWorldInterceptor() {
    if (document.getElementById("flowzero-interceptor")) return;
    try {
      const script = document.createElement("script");
      script.id = "flowzero-interceptor";
      script.src = chrome.runtime.getURL("scripts/interceptor.js");
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.warn("[FlowZero] Injection warning:", e);
    }
  }

  // Listen for video progress events from background/offscreen
  chrome.runtime.onMessage.addListener((message) => {
    if (message.target === "content" && message.action === "videoProgress") {
      const { progress } = message;
      if (progress) {
        const pct = progress.percent || 0;
        const phaseMsg = progress.phase === "finalizing"
          ? "Đang đóng gói file MP4..."
          : progress.phase === "audio"
          ? "Đang đồng bộ âm thanh..."
          : `Đang xóa watermark video (${pct}%)...`;
        showToast(phaseMsg, "info", 0, pct);
      }
    }
  });

  // Listen for intercepted downloads from main world script
  window.addEventListener("message", async (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === "FLOWZERO_INTERCEPT_DOWNLOAD") {
      const { dataUrl: preloadedDataUrl, url, filename, mediaType } = event.data;
      if (!preloadedDataUrl && !url) return;

      if (!isExtensionEnabled) {
        // Just download directly without processing
        const a = document.createElement("a");
        a.href = url || preloadedDataUrl;
        a.download = filename || "download";
        a.setAttribute("data-flowzero-passthrough", "true");
        document.body.appendChild(a); // Needs to be in DOM for some browsers to allow click download
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
        const dataUrl = preloadedDataUrl || (await urlToDataUrl(url));
        if (!dataUrl) throw new Error("Không thể chuyển đổi dữ liệu từ liên kết");

        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              action: isVideo ? "removeVideoWatermarkAndDownload" : "removeWatermarkAndDownload",
              imageUrl: !isVideo ? dataUrl : undefined,
              videoUrl: isVideo ? dataUrl : undefined,
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

  // Initialize FlowZero Content Script
  function init() {
    injectStyles();
    injectMainWorldInterceptor();

    // Check storage for enabled state
    chrome.storage.local.get(["flowzero_enabled"], (res) => {
      isExtensionEnabled = res.flowzero_enabled !== false;
      updateButtonsVisibility();
      if (isExtensionEnabled) {
        scanAndInject();
      }
    });

    // Listen for toggle updates from popup
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.flowzero_enabled !== undefined) {
        isExtensionEnabled = changes.flowzero_enabled.newValue !== false;
        updateButtonsVisibility();
        if (isExtensionEnabled) {
          scanAndInject();
        }
      }
    });

    // Observe DOM changes on Google Flow app
    const observer = new MutationObserver(() => {
      if (isExtensionEnabled) {
        scanAndInject();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log("[FlowZero] Content script loaded with Quality Menu & On/Off Toggle.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
