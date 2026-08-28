const {
    contextBridge,
    ipcRenderer
} = require("electron");


contextBridge.exposeInMainWorld(
    "electronAPI",
    {

        onTrayStopAudio: callback => {

            ipcRenderer.on(
                "tray-stop-audio",
                callback
            );

        }

    }
);