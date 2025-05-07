const { app, BrowserWindow, ipcMain, dialog, Tray, Menu } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');

// Enable hot reloading in development - optional
try {
  require('electron-reloader')(module);
} catch (_) {}

let mainWindow;
let tray = null;

// Check for single instance lock
const gotTheLock = app.requestSingleInstanceLock();

// If we couldn't get the lock, quit the app
if (!gotTheLock) {
  console.log('Another instance is already running. Quitting...');
  app.quit();
} else {
  // If someone tries to open a second instance, focus our window instead
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('Second instance detected, focusing the main window');

    // If window exists but is minimized, restore it
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      // Show and focus window
      mainWindow.show();
      mainWindow.focus();
    } else {
      // If window was closed but app is still in tray, create a new window
      createWindow();
    }
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      frame: false, // Remove default window frame
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        webSecurity: true,
        allowRunningInsecureContent: false,
      }
    });

    // Load the Angular app URL
    const startUrl = process.env.ELECTRON_START_URL || url.format({
      pathname: path.join(__dirname, 'dist/genia/browser/index.html'), // This is fine as Angular 19 uses /browser subdirectory
      protocol: 'file:',
      slashes: true
    });
    mainWindow.loadURL(startUrl);

    if (process.env.NODE_ENV === 'production') {
      // Open DevTools - remove for production
      // mainWindow.webContents.openDevTools();
    }

    // Hide window instead of closing when user clicks the close button
    mainWindow.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        mainWindow.hide();
        return false;
      }
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  function createTray() {
    // Set the tray icon with proper path resolution for both dev and prod environments
    let iconPath;

    if (process.env.ELECTRON_START_URL) {
      // In development mode
      iconPath = path.join(__dirname, 'public', 'assets', 'icons', 'logo_genia.png');
    } else {
      // In production mode - look in the Angular build output
      iconPath = path.join(__dirname, 'dist', 'genia', 'browser', 'assets', 'icons', 'logo_genia.png');
    }

    // Debug: Log icon path and check if file exists
    console.log('Trying to load tray icon from:', iconPath);
    console.log('Icon file exists:', fs.existsSync(iconPath));

    try {
      tray = new Tray(iconPath);

      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Open',
          click: () => {
            if (mainWindow === null) {
              createWindow();
            } else {
              mainWindow.show();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            app.isQuitting = true;
            app.quit();
          }
        }
      ]);

      tray.setToolTip('Genia');
      tray.setContextMenu(contextMenu);

      // Double-click on tray icon to show window
      tray.on('double-click', () => {
        if (mainWindow === null) {
          createWindow();
        } else {
          mainWindow.show();
        }
      });
    } catch (error) {
      console.error('Failed to create tray:', error);

      // If we still don't have a tray, create one with nativeImage as a last resort
      if (!tray) {
        console.log('Creating empty tray as fallback');
        const { nativeImage } = require('electron');
        const emptyIcon = nativeImage.createEmpty();
        tray = new Tray(emptyIcon);
        tray.setToolTip('Genia');
        tray.setContextMenu(contextMenu);
      }
    }
  }

  app.on('ready', () => {
    // Debug application paths
    console.log('Application paths for debugging:');
    console.log('__dirname:', __dirname);
    console.log('app.getAppPath():', app.getAppPath());

    createWindow();
    createTray();
  });

  app.on('window-all-closed', () => {
    // On macOS it's common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
      createWindow();
    }
  });

  ipcMain.on('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('maximize-window', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('close-window', () => {
    if (mainWindow) {
      // Keep your existing quit logic
      if (!app.isQuitting) {
        mainWindow.hide();
      } else {
        mainWindow.close();
      }
    }
  });

  ipcMain.handle('is-window-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });


  // --- Basic IPC Example (for later use) ---
  ipcMain.handle('show-open-dialog', async (event, options) => {
    if (!mainWindow) return null; // Or handle appropriately
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
  });

  // Add auto-launch functionality
  // Note: You'll need to install the auto-launch package:
  // npm install auto-launch --save
  // Uncomment the following code after installing the package:

  /*
  const AutoLaunch = require('auto-launch');

  const autoLauncher = new AutoLaunch({
    name: 'Genia',
    path: app.getPath('exe'),
  });

  // Check if auto-launch is enabled and enable if it's not
  autoLauncher.isEnabled()
    .then((isEnabled) => {
      if (!isEnabled) {
        // Enable auto-launch
        autoLauncher.enable();
      }
    })
    .catch((err) => {
      console.error('Auto-launch check failed:', err);
    });

  // Add IPC handler for toggling auto-launch from the renderer
  ipcMain.handle('toggle-auto-launch', async (event, enable) => {
    try {
      if (enable) {
        await autoLauncher.enable();
      } else {
        await autoLauncher.disable();
      }
      return true;
    } catch (error) {
      console.error('Failed to toggle auto-launch:', error);
      return false;
    }
  });

  // Add IPC handler for checking auto-launch status
  ipcMain.handle('get-auto-launch-status', async () => {
    try {
      return await autoLauncher.isEnabled();
    } catch (error) {
      console.error('Failed to get auto-launch status:', error);
      return false;
    }
  });
  */
}
