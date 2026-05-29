// background/alarms.js — Registra el listener único de alarms.
(function () {
  const { ALARMS } = self.__engineConst;
  const { makeEvent } = self.__engineContracts;

  function register() {
    if (self.__engineAlarmListenerRegistered) return;
    self.__engineAlarmListenerRegistered = true;

    chrome.alarms.onAlarm.addListener((alarm) => {
      switch (alarm.name) {
        case ALARMS.POLL:
          self.__engineBridge.poll();
          break;
        case ALARMS.FLUSH:
          self.__engineBridge.flush();
          break;
        case ALARMS.HEARTBEAT:
          self.__engineBridge.enqueue(makeEvent("heartbeat"));
          break;
        case ALARMS.HEALTH:
          // health pings al content (recovery se hace allí)
          chrome.tabs.query({ url: "https://web.whatsapp.com/*" }, (tabs) => {
            tabs.forEach((t) =>
              chrome.tabs.sendMessage(t.id, { __engine: true, type: "HEALTH_PING" }).catch(() => {})
            );
          });
          break;
      }
    });
  }

  self.__engineAlarms = { register };
})();
