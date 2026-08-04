/*
 * FlowZero Popup JS
 */

document.addEventListener("DOMContentLoaded", async () => {
  const toggleEnabled = document.getElementById("toggleEnabled");
  const statusBadge = document.getElementById("statusBadge");
  const detectedTier = document.getElementById("detectedTier");

  // Load state from chrome.storage
  chrome.storage.local.get(["flowzero_enabled", "flowzero_detected_tier"], (res) => {
    const enabled = res.flowzero_enabled !== false;
    toggleEnabled.checked = enabled;
    updateStatusUI(enabled);
    
    if (res.flowzero_detected_tier) {
      if (res.flowzero_detected_tier.includes("PAYGATE_TIER_") && !res.flowzero_detected_tier.includes("NOT_PAID")) {
        const tierStr = res.flowzero_detected_tier.replace("PAYGATE_TIER_", "");
        if (tierStr === "ONE") {
          detectedTier.textContent = "PRO (" + tierStr + ")";
          detectedTier.style.color = "#3b82f6"; // Blue for PRO
        } else {
          detectedTier.textContent = "ULTRA (" + tierStr + ")";
          detectedTier.style.color = "#22c55e"; // Green for ULTRA
        }
      } else {
        detectedTier.textContent = "Miễn phí";
        detectedTier.style.color = "#94a3b8"; // Gray for Free
      }
    }
  });

  // Handle toggle change
  toggleEnabled.addEventListener("change", () => {
    const enabled = toggleEnabled.checked;
    chrome.storage.local.set({ flowzero_enabled: enabled });
    updateStatusUI(enabled);
  });

  function updateStatusUI(enabled) {
    if (enabled) {
      statusBadge.textContent = "Active";
      statusBadge.classList.remove("disabled");
    } else {
      statusBadge.textContent = "Disabled";
      statusBadge.classList.add("disabled");
    }
  }
});
