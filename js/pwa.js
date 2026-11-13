(function () {
  let registrationPromise;
  let installPrompt = null;
  let downloadQueue = Promise.resolve();

  function register() {
    if (!("serviceWorker" in navigator)) {
      return Promise.reject(
        new Error("This browser does not support offline storage."),
      );
    }
    if (!window.isSecureContext && location.hostname !== "localhost") {
      return Promise.reject(
        new Error("Offline storage requires HTTPS or localhost."),
      );
    }
    if (!registrationPromise) {
      registrationPromise = navigator.serviceWorker
        .register("service-worker.js")
        .catch((error) => {
          registrationPromise = null;
          throw error;
        });
    }
    return registrationPromise;
  }

  async function sendMessage(message) {
    const registration = await register();
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, rej) =>
        setTimeout(
          () =>
            rej(
              new Error("Offline storage didn't start. Reload and try again."),
            ),
          10000,
        ),
      ),
    ]);
    const worker = navigator.serviceWorker.controller || ready.active;
    if (!worker)
      throw new Error("Offline storage is still starting. Try again.");

    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => {
        channel.port1.close();
        reject(new Error("The offline request timed out. Try again."));
      }, 30000);
      channel.port1.onmessage = ({ data }) => {
        window.clearTimeout(timeout);
        channel.port1.close();
        if (!data?.ok) {
          reject(new Error(data?.error || "The offline request failed."));
          return;
        }
        resolve(data.result);
      };
      worker.postMessage(message, [channel.port2]);
    });
  }

  function getBookStatuses(paths) {
    return sendMessage({ action: "get-book-statuses", paths });
  }

  function saveBook(path) {
    const task = downloadQueue.then(() =>
      sendMessage({ action: "save-book", path }),
    );
    downloadQueue = task.catch(() => {});
    return task;
  }

  function removeBook(path) {
    return sendMessage({ action: "remove-book", path });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    document.dispatchEvent(new Event("pwa-installable"));
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
  });

  async function promptInstall() {
    if (!installPrompt) return null;
    const prompt = installPrompt;
    installPrompt = null;
    await prompt.prompt();
    return prompt.userChoice;
  }

  window.EndingPWA = {
    getBookStatuses,
    promptInstall,
    register,
    removeBook,
    saveBook,
  };
})();
