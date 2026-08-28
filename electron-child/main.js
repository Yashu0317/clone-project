const {
    app,
    BrowserWindow,
    Tray,
    Menu,
    nativeImage
} = require("electron");

const path = require("path");

let mainWindow = null;
let tray = null;
let isQuitting = false;


function createWindow() {

    mainWindow = new BrowserWindow({

        width: 550,
        height: 750,

        minWidth: 450,
        minHeight: 600,

        show: false,

        webPreferences: {

            preload: path.join(
                __dirname,
                "preload.js"
            ),

            contextIsolation: true,

            nodeIntegration: false,

            // Helps prevent renderer throttling
            backgroundThrottling: false

        }

    });


    mainWindow.loadFile(
        path.join(
            __dirname,
            "child.html"
        )
    );


    mainWindow.once(
        "ready-to-show",
        () => {

            mainWindow.show();

        }
    );


    // Hide instead of closing
    mainWindow.on(
        "close",
        event => {

            if (!isQuitting) {

                event.preventDefault();

                mainWindow.hide();

            }

        }
    );

}


function createTray() {

    /*
    Using an empty icon for now.

    Later you can add:
    icon.png

    and replace this with:
    new Tray(path.join(__dirname, "icon.png"))
    */

    const icon =
        nativeImage.createEmpty();


    tray = new Tray(icon);


    const menu =
        Menu.buildFromTemplate([

            {

                label:
                    "Show Child Audio App",

                click: () => {

                    if (!mainWindow) {
                        return;
                    }

                    mainWindow.show();

                    mainWindow.focus();

                }

            },


            {

                label:
                    "Stop Audio Sharing",

                click: () => {

                    if (mainWindow) {

                        mainWindow.webContents.send(
                            "tray-stop-audio"
                        );

                    }

                }

            },


            {
                type: "separator"
            },


            {

                label:
                    "Quit Application",

                click: () => {

                    isQuitting = true;

                    app.quit();

                }

            }

        ]);


    tray.setToolTip(
        "Child Audio Sharing"
    );


    tray.setContextMenu(menu);


    tray.on(
        "click",
        () => {

            if (!mainWindow) {
                return;
            }

            mainWindow.show();

            mainWindow.focus();

        }
    );

}


app.whenReady().then(() => {

    createWindow();

    createTray();

});


app.on(
    "before-quit",
    () => {

        isQuitting = true;

    }
);


// Windows/Linux behaviour
app.on(
    "window-all-closed",
    () => {

        // Do not quit automatically.
        // The tray remains available.

    }
);


app.on(
    "activate",
    () => {

        if (!mainWindow) {

            createWindow();

        } else {

            mainWindow.show();

        }

    }
);