/*
 * FlowZero Content Script - Google Flow UI Injector
 * Injects "FlowZero" download buttons with 1K, 2K, 4K (Ultra) quality menu on Google Flow images.
 */

(() => {
  const WRAPPER_CLASS = "flowzero-btn-wrapper";
  const PROCESSED_ATTR = "data-flowzero-injected";

  let isExtensionEnabled = true;

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
      }

      .flowzero-hidden {
        display: none !important;
      }

      /* Main Trigger Button */
      .flowzero-main-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: rgba(15, 23, 42, 0.90);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(168, 85, 247, 0.4);
        border-radius: 14px;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .flowzero-main-btn:hover,
      .${WRAPPER_CLASS}.is-hovered .flowzero-main-btn {
        background: rgba(30, 41, 59, 0.98);
        border-color: #a855f7;
        transform: translateY(-1px) scale(1.02);
        box-shadow: 0 6px 18px rgba(168, 85, 247, 0.45);
      }

      .flowzero-main-btn:active {
        transform: translateY(0) scale(0.98);
      }

      .flowzero-main-btn svg.flowzero-logo-icon {
        width: 13px;
        height: 13px;
        fill: none;
        stroke: #a855f7;
        stroke-width: 2.5;
        stroke-linecap: round;
        stroke-linejoin: round;
        transition: stroke 0.2s ease;
      }

      .flowzero-main-btn:hover svg.flowzero-logo-icon,
      .${WRAPPER_CLASS}.is-hovered svg.flowzero-logo-icon {
        stroke: #c084fc;
      }

      .flowzero-chevron {
        font-size: 8px;
        opacity: 0.75;
        transition: transform 0.2s ease;
        margin-left: 2px;
      }

      .${WRAPPER_CLASS}:hover .flowzero-chevron,
      .${WRAPPER_CLASS}.is-hovered .flowzero-chevron {
        transform: rotate(180deg);
      }

      /* Loading & Success States */
      .flowzero-main-btn.is-loading {
        pointer-events: none;
        opacity: 0.9;
        border-color: #3b82f6;
      }

      .flowzero-main-btn.is-loading svg.flowzero-logo-icon {
        stroke: #3b82f6;
        animation: flowzero-spin 1s linear infinite;
      }

      .flowzero-main-btn.is-success {
        background: rgba(22, 101, 52, 0.95);
        border-color: #22c55e;
      }

      .flowzero-main-btn.is-success svg.flowzero-logo-icon {
        stroke: #22c55e;
      }

      @keyframes flowzero-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      /* Hover Dropdown Menu */
      .flowzero-dropdown-menu {
        position: absolute;
        bottom: calc(100% + 4px);
        right: 0;
        width: 210px;
        background: rgba(15, 23, 42, 0.96);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 14px;
        padding: 6px;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.65);
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

      .flowzero-menu-header {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.6px;
        color: #94a3b8;
        text-transform: uppercase;
        padding: 6px 10px 4px 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        margin-bottom: 4px;
      }

      .flowzero-menu-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 8px 10px;
        background: transparent;
        border: none;
        border-radius: 8px;
        color: #f1f5f9;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        cursor: pointer;
        text-align: left;
        transition: all 0.15s ease;
      }

      .flowzero-menu-item:hover {
        background: rgba(168, 85, 247, 0.22);
        color: #ffffff;
        transform: translateX(-2px);
      }

      .flowzero-menu-item:active {
        transform: scale(0.97);
      }

      .flowzero-item-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .flowzero-res-icon {
        font-weight: 700;
        font-size: 11px;
        color: #a855f7;
        width: 22px;
        text-align: center;
      }

      .flowzero-item-title {
        font-weight: 500;
      }

      /* Badges */
      .flowzero-badge {
        font-size: 9.5px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 6px;
        text-transform: uppercase;
      }

      .badge-free {
        background: rgba(148, 163, 184, 0.2);
        color: #cbd5e1;
      }

      .badge-hd {
        background: rgba(59, 130, 246, 0.25);
        color: #60a5fa;
        border: 1px solid rgba(59, 130, 246, 0.4);
      }

      .badge-ultra {
        background: linear-gradient(135deg, rgba(245, 158, 11, 0.3), rgba(239, 68, 68, 0.3));
        color: #fbbf24;
        border: 1px solid rgba(245, 158, 11, 0.5);
      }

      .flowzero-menu-item.is-locked {
        opacity: 0.85;
      }

      .flowzero-menu-item.is-locked:hover {
        background: rgba(245, 158, 11, 0.18);
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
        background: #0f172a;
        border: 1px solid rgba(168, 85, 247, 0.4);
        border-radius: 12px;
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13.5px;
        font-weight: 500;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
        animation: flowzero-toast-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes flowzero-toast-in {
        from { opacity: 0; transform: translateY(12px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
    `;
    document.head.appendChild(style);
  }

  // Show Toast Notification
  function showToast(message, type = "info", duration = 3200) {
    const existing = document.querySelector(".flowzero-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "flowzero-toast";

    const iconColor = type === "success" ? "#22c55e" : type === "error" ? "#ef4444" : type === "warning" ? "#f59e0b" : "#a855f7";
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        ${type === "success" ? '<polyline points="20 6 9 17 4 12"></polyline>' :
          type === "error" ? '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>' :
          type === "warning" ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>' :
          '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>'}
      </svg>
      <span>${message}</span>
    `;

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = "opacity 0.3s ease, transform 0.3s ease";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 300);
    }, duration);
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

    if (container.tagName === "IMG" && container.src) {
      return container.currentSrc || container.src;
    }
    const img = container.querySelector("img");
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
      await sleep(100);
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
    downloadItem.dispatchEvent(new PointerEvent("pointerdown", { ...pointerOpts, button: 0 }));
    downloadItem.dispatchEvent(new PointerEvent("pointerup", { ...pointerOpts, button: 0 }));
    downloadItem.dispatchEvent(new MouseEvent("mouseover", mouseOpts));
    downloadItem.dispatchEvent(new MouseEvent("mouseenter", mouseOpts));
    downloadItem.click();

    // 5. Wait for Submenu with resolutions (1K, 2K, 4K)
    let subMenu = null;
    for (let i = 0; i < 15; i++) {
      await sleep(100);
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

    // 6. Find target resolution item (e.g. 2K, 4K, 1K)
    const subItems = subMenu.querySelectorAll('[role="menuitem"], button, div[tabindex]');
    let targetSubItem = null;

    for (const item of subItems) {
      const text = item.textContent?.trim() || "";
      if (text.toUpperCase().startsWith(resUpper) || text.toUpperCase().includes(resUpper)) {
        if (item.getAttribute("aria-disabled") === "true" || item.hasAttribute("disabled")) {
          console.warn(`[FlowZero] Option ${resUpper} is disabled in Flow.`);
          showToast(`🔒 Tùy chọn ${resUpper} không khả dụng cho tài khoản hiện tại`, "warning", 3500);
          return false;
        }
        targetSubItem = item;
        break;
      }
    }

    if (!targetSubItem) {
      console.warn(`[FlowZero] Submenu item for ${resUpper} not found. Available:`, Array.from(subItems).map(i => i.textContent?.trim()));
      return false;
    }

    // 7. Click target resolution item to trigger native Flow upscale & download!
    console.log(`[FlowZero] Clicking Flow native [${resUpper}] item:`, targetSubItem.textContent?.trim());
    targetSubItem.click();
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
      // If 2K or 4K, attempt native Flow upscale automation first
      if (resKey === "2k" || resKey === "4k") {
        showToast(`⚡ Đang yêu cầu Google Flow upscale ${resKey.toUpperCase()} & xóa watermark...`, "info", 4000);
        const menuTriggered = await triggerFlowNativeDownload(targetContainer, resKey);
        if (menuTriggered) {
          // Flow native download will trigger and interceptor.js will capture and clean it!
          setTimeout(() => {
            btn.classList.remove("is-loading");
            if (labelSpan) labelSpan.textContent = originalText;
          }, 3000);
          return;
        }
        console.log("[FlowZero] Menu automation skipped/fallback to direct stream...");
      }

      const filename = `flowzero_${resKey}_${Date.now()}.png`;
      const dataUrl = await urlToDataUrl(rawUrl, resKey);
      if (!dataUrl) throw new Error("Không thể chuyển đổi dữ liệu hình ảnh");

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "removeWatermarkAndDownload",
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
      if (labelSpan) labelSpan.textContent = response.cleaned ? `✓ Đã lưu ${resKey.toUpperCase()} sạch!` : `✓ Đã tải ${resKey.toUpperCase()}!`;
      showToast(
        response.cleaned
          ? `✓ Đã xóa watermark & lưu ảnh ${resKey.toUpperCase()} thành công!`
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
    wrappers.forEach((w) => {
      if (isExtensionEnabled) {
        w.classList.remove("flowzero-hidden");
      } else {
        w.classList.add("flowzero-hidden");
      }
    });
  }

  // Inject FlowZero button + Hover Quality Menu into image containers
  function injectButtonInto(container) {
    if (container.hasAttribute(PROCESSED_ATTR)) return;
    container.setAttribute(PROCESSED_ATTR, "true");

    const computedStyle = window.getComputedStyle(container);
    if (computedStyle.position === "static") {
      container.style.position = "relative";
    }

    const wrapper = document.createElement("div");
    wrapper.className = WRAPPER_CLASS;
    if (!isExtensionEnabled) {
      wrapper.classList.add("flowzero-hidden");
    }

    wrapper.innerHTML = `
      <div class="flowzero-dropdown-menu">
        <div class="flowzero-menu-header">Tùy chọn chất lượng</div>
        <button class="flowzero-menu-item" data-quality="1k">
          <div class="flowzero-item-left">
            <span class="flowzero-res-icon">1K</span>
            <span class="flowzero-item-title">Chuẩn (1K)</span>
          </div>
          <span class="flowzero-badge badge-free">Free</span>
        </button>
        <button class="flowzero-menu-item" data-quality="2k">
          <div class="flowzero-item-left">
            <span class="flowzero-res-icon">2K</span>
            <span class="flowzero-item-title">Sắc nét (2K)</span>
          </div>
          <span class="flowzero-badge badge-hd">HD</span>
        </button>
        <button class="flowzero-menu-item is-locked" data-quality="4k" title="Chất lượng 4K (Ultra) dành cho gói nâng cao">
          <div class="flowzero-item-left">
            <span class="flowzero-res-icon">4K</span>
            <span class="flowzero-item-title">Siêu nét (4K)</span>
          </div>
          <span class="flowzero-badge badge-ultra">🔒 Ultra</span>
        </button>
      </div>

      <button class="flowzero-main-btn" title="Tải ảnh không có Watermark với FlowZero">
        <svg class="flowzero-logo-icon" viewBox="0 0 24 24">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
        <span class="flowzero-label">FlowZero</span>
        <span class="flowzero-chevron">▲</span>
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
      "div[role='img']",
      "img[src*='googleusercontent.com']",
      "img[src*='labs.google']",
      ".tile-image-container",
      "[data-test-id='media-tile']",
      "[data-tile-id]"
    ];

    const elements = document.querySelectorAll(selectors.join(", "));
    elements.forEach((el) => {
      const container = el.tagName === "IMG" ? (el.parentElement || el) : el;
      if (container && container.offsetWidth > 150 && container.offsetHeight > 150) {
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

  // Listen for intercepted downloads from main world script
  window.addEventListener("message", async (event) => {
    if (!isExtensionEnabled) return;
    if (event.source !== window || !event.data) return;
    if (event.data.type === "FLOWZERO_INTERCEPT_DOWNLOAD") {
      const { dataUrl: preloadedDataUrl, url, filename } = event.data;
      if (!preloadedDataUrl && !url) return;

      showToast("⚡ FlowZero: Đang tự động xóa watermark...", "info", 3500);

      try {
        const dataUrl = preloadedDataUrl || (await urlToDataUrl(url));
        if (!dataUrl) throw new Error("Không thể chuyển đổi dữ liệu hình ảnh từ liên kết");

        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              action: "removeWatermarkAndDownload",
              imageUrl: dataUrl,
              filename: filename || `flowzero_${Date.now()}.png`
            },
            (res) => resolve(res || { success: false })
          );
        });

        if (response && response.success) {
          showToast(
            response.cleaned ? "✓ FlowZero: Đã xóa watermark & lưu ảnh thành công!" : "✓ FlowZero: Đã tải hình ảnh thành công!",
            "success",
            3500
          );
        } else {
          showToast("Lỗi khi xóa watermark: " + (response?.error || "Không thành công"), "error");
        }
      } catch (err) {
        console.error("[FlowZero Content Message Error]:", err);
        showToast("Lỗi xử lý tải ảnh: " + err.message, "error");
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
