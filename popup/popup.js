/*
 * FlowZero Popup JS
 */

document.addEventListener("DOMContentLoaded", async () => {
  const toggleEnabled = document.getElementById("toggleEnabled");
  const statusBadge = document.getElementById("statusBadge");
  const cleanedCount = document.getElementById("cleanedCount");

  // Load state from chrome.storage
  chrome.storage.local.get(["flowzero_enabled", "flowzero_cleaned_count"], (res) => {
    const enabled = res.flowzero_enabled !== false;
    toggleEnabled.checked = enabled;
    updateStatusUI(enabled);

    cleanedCount.textContent = res.flowzero_cleaned_count || 0;
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
