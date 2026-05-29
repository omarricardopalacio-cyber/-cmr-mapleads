// background/command-dispatcher.js — Recibe comandos del backend y los envía al content.
(function () {
  const { COMMANDS } = self.__engineContracts;

  async function dispatch(cmd) {
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    if (!tabs.length) {
      self.__engineBridge.enqueue({
        type: "ack",
        commandId: cmd.id,
        ackStatus: "no_whatsapp_tab",
      });
      return;
    }
    if (cmd.type === COMMANDS.SEND_MESSAGE) {
      try {
        const response = await chrome.tabs.sendMessage(tabs[0].id, {
          __engine: true,
          type: "SEND_MESSAGE",
          commandId: cmd.id,
          payload: cmd.payload,
        });

        if (!response?.ok) {
          self.__engineBridge.enqueue({
            type: "ack",
            commandId: cmd.id,
            ackStatus: "content_unreachable",
            raw: { response: response ?? null },
          });
        }
      } catch (error) {
        self.__engineBridge.enqueue({
          type: "ack",
          commandId: cmd.id,
          ackStatus: "content_unreachable",
          raw: { error: String(error?.message || error) },
        });
      }
    } else {
      self.__engineBridge.enqueue({
        type: "ack",
        commandId: cmd.id,
        ackStatus: "unknown_command",
      });
    }
  }

  self.__engineDispatcher = { dispatch };
})();
