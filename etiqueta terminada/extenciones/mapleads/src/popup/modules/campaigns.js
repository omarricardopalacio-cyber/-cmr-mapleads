(() => {
  async function loadCampaignOptions(savedCampaignSelect) {
    const campaigns = globalThis.MLStorage ? await globalThis.MLStorage.getCampaigns() : [];
    savedCampaignSelect.innerHTML = campaigns.length
      ? campaigns
          .map((c, i) => `<option value="${i}">${(c.name || "Sin nombre").replace(/</g, "")}</option>`)
          .join("")
      : `<option value="">—</option>`;
    return campaigns;
  }

  async function saveCampaignSnapshot(name, snapshot) {
    const campaigns = globalThis.MLStorage ? await globalThis.MLStorage.getCampaigns() : [];
    campaigns.push({ name, savedAt: Date.now(), snapshot });
    if (globalThis.MLStorage) {
      await globalThis.MLStorage.saveCampaigns(campaigns);
    }
    return campaigns;
  }

  async function getCampaignByIndex(index) {
    const campaigns = globalThis.MLStorage ? await globalThis.MLStorage.getCampaigns() : [];
    return campaigns[Number(index)];
  }

  globalThis.MLPopupCampaigns = { loadCampaignOptions, saveCampaignSnapshot, getCampaignByIndex };
})();
