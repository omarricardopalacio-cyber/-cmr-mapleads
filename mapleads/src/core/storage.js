(() => {
  const KEY = {
    campaigns: "mls_campaigns",
    queue: "mls_queue",
    license: "mls_license"
  };

  async function get(key, fallback = null) {
    const data = await chrome.storage.local.get([key]);
    return data[key] ?? fallback;
  }

  async function set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }

  async function getCampaigns() {
    return get(KEY.campaigns, []);
  }

  async function saveCampaigns(list) {
    return set(KEY.campaigns, list || []);
  }

  async function getLicense() {
    return get(KEY.license, { key: "", valid: false });
  }

  async function saveLicense(license) {
    return set(KEY.license, license || { key: "", valid: false });
  }

  globalThis.MLStorage = {
    KEY,
    get,
    set,
    getCampaigns,
    saveCampaigns,
    getLicense,
    saveLicense
  };
})();
