(() => {
  function setMessage(messageEl, text, isError = false) {
    messageEl.textContent = text;
    messageEl.classList.toggle("err", isError);
  }

  function setUiRunning({ startBtn, continueBtn, stopBtn, pauseBtn, resumeBtn, runBadge }, running, paused = false) {
    startBtn.disabled = running;
    if (continueBtn) continueBtn.disabled = running;
    stopBtn.disabled = !running;
    pauseBtn.disabled = !running || paused;
    resumeBtn.disabled = !running || !paused;

    if (running && paused) {
      runBadge.textContent = "Pausado";
      runBadge.className = "badge badge-pause";
      return;
    }
    if (running) {
      runBadge.textContent = "Extrayendo";
      runBadge.className = "badge badge-run";
      return;
    }
    runBadge.textContent = "Listo";
    runBadge.className = "badge badge-stop";
  }

  function setCounts({ leadCountEl, phoneCountEl }, count, withPhone) {
    leadCountEl.textContent = String(count);
    phoneCountEl.textContent = String(withPhone);
  }

  function setProgress({ taskProgressBar, taskProgressText, searchRateText }, progressPercent, completed, total, rate) {
    const safeTotal = Math.max(0, Number(total || 0));
    const safeCompleted = Math.max(0, Number(completed || 0));
    const boundedCompleted = safeTotal > 0 ? Math.min(safeCompleted, safeTotal) : 0;
    const safePercent = safeTotal > 0 ? Math.round((boundedCompleted / safeTotal) * 100) : Math.max(0, Math.min(100, Number(progressPercent || 0)));
    if (taskProgressBar) {
      taskProgressBar.max = safeTotal > 0 ? safeTotal : 100;
      taskProgressBar.value = safeTotal > 0 ? boundedCompleted : 0;
      taskProgressBar.setAttribute("aria-valuetext", `${safePercent}%`);
      taskProgressBar.title = `${safePercent}%`;
    }
    if (taskProgressText) taskProgressText.textContent = `${safeCompleted} / ${safeTotal} búsquedas (${safePercent}%)`;
    if (searchRateText) searchRateText.textContent = `${Number(rate || 0).toFixed(2)} búsquedas/min`;
  }

  function setLicenseBadge(licenseBadgeEl, validation) {
    if (validation?.valid) {
      licenseBadgeEl.textContent = "Pro";
      licenseBadgeEl.className = "badge badge-run";
      return;
    }
    licenseBadgeEl.textContent = "Free";
    licenseBadgeEl.className = "badge badge-stop";
  }

  globalThis.MLPopupUi = { setMessage, setUiRunning, setCounts, setProgress, setLicenseBadge };
})();
