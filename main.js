const { app, BrowserWindow, ipcMain, dialog, Tray, Menu } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const fsPromises = fs.promises;
const chokidar = require('chokidar');

// Global watcher instance
let folderWatchers = [];

// Global variable to track folders being indexed
let foldersBeingIndexed = [];

// Global indexation error log
let indexationErrorLog = {
  errors: [],
  lastUpdated: null
};

// File queue for batch processing
let fileQueue = [];
let processingBatch = false;

// Simple throttle implementation
function throttle(func, delay) {
  let lastCall = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      return func.apply(this, args);
    }
  };
}

// Simple debounce implementation
function debounce(func, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

// Queue a file for indexing or removal
function queueFileForProcessing(path, folderId, folderPath, action) {
  fileQueue.push({ path, folderId, folderPath, action });

  if (!processingBatch) {
    processBatch();
  }
}

// Process files in batches
async function processBatch() {
  if (fileQueue.length === 0) {
    processingBatch = false;
    return;
  }

  processingBatch = true;

  // Take a batch of up to 50 files
  const batch = fileQueue.splice(0, 50);

  // Process the batch
  for (const item of batch) {
    try {
      if (item.action === 'add' || item.action === 'change') {
        await indexFile(item.path, item.folderId, item.folderPath);
      } else if (item.action === 'unlink') {
        await removeFileFromIndex(item.path, item.folderId, item.folderPath);
      }
    } catch (error) {
      console.error(`Error processing file ${item.path}:`, error);
      logIndexationError(item.folderPath, item.path, error);
    }
  }

  // Process next batch after a short delay
  setTimeout(processBatch, 100);
}

// Helper function to add an error to the log
function logIndexationError(folderPath, filePath, error) {
  indexationErrorLog.errors.push({
    timestamp: new Date(),
    folderPath,
    filePath,
    error: error.toString()
  });
  indexationErrorLog.lastUpdated = new Date();

  // Limit the log size to prevent memory issues (keep last 1000 errors)
  if (indexationErrorLog.errors.length > 1000) {
    indexationErrorLog.errors = indexationErrorLog.errors.slice(-1000);
  }
}

// Helper function to clear the error log
function clearIndexationErrorLog() {
  indexationErrorLog.errors = [];
  indexationErrorLog.lastUpdated = new Date();
  return { success: true, message: 'Error log cleared' };
}

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

  // --- File Indexing and Watching Handlers ---

  // Helper function to read a file
  async function readFile(filePath) {
    try {
      const content = await fsPromises.readFile(filePath, 'utf8');
      return content;
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return null;
    }
  }

  // Helper function to check if a file should be indexed
  function shouldIndexFile(filePath) {
    // Skip hidden files and directories
    if (path.basename(filePath).startsWith('.')) {
      return false;
    }

    // Get file extension
    const ext = path.extname(filePath).toLowerCase();

    // List of extensions to index
    const indexableExtensions = [
      '.txt', '.md', '.markdown', '.html', '.htm', '.xml', '.json',
      '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.less',
      '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rb', '.php',
      '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.pdf',
      '.rtf', '.csv'
    ];

    return indexableExtensions.includes(ext);
  }

  // Helper function to index a single file
  async function indexFile(filePath, folderId, folderPath) {
    try {
      if (!shouldIndexFile(filePath)) {
        return null;
      }

      // console.log(`Indexing file: ${filePath}`);

      // Read file content
      const content = await readFile(filePath);
      if (content === null) {
        // Log error for null content
        logIndexationError(folderPath, filePath, new Error('Failed to read file content'));
        return null;
      }

      // In a real implementation, you would:
      // 1. Generate embeddings for the content
      // 2. Store the embeddings in a vector database
      // 3. Return metadata about the indexed file

      // For now, we'll just return basic file info
      const stats = await fsPromises.stat(filePath);
      return {
        path: filePath,
        filename: path.basename(filePath),
        size: stats.size,
        lastModified: stats.mtime,
        indexed: true
      };
    } catch (error) {
      console.error(`Error indexing file ${filePath}:`, error);
      // Log the error but don't stop the indexation process
      logIndexationError(folderPath, filePath, error);
      return null;
    }
  }

  // Helper function to remove a file from the index
  async function removeFileFromIndex(filePath, folderId, folderPath) {
    try {
      console.log(`Removing file from index: ${filePath}`);

      // In a real implementation, you would:
      // 1. Remove the file's embeddings from your vector database
      // 2. Remove any metadata about the file from your index
      // 3. Return information about the removed file

      return {
        path: filePath,
        filename: path.basename(filePath),
        removed: true
      };
    } catch (error) {
      console.error(`Error removing file ${filePath} from index:`, error);
      // Log the error but don't stop the process
      logIndexationError(folderPath, filePath, error);
      return null;
    }
  }

  // Helper function to recursively count files in a directory and all its subdirectories
  async function countFiles(dirPath) {
    try {
      let count = 0;
      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          try {
            // Recursively count files in subdirectory
            const subCount = await countFiles(fullPath);
            count += subCount;
          } catch (error) {
            console.error(`Error counting files in subdirectory ${fullPath}:`, error);
            // Continue with other entries despite this error
          }
        } else if (entry.isFile()) {
          // Only count files that should be indexed
          if (shouldIndexFile(fullPath)) {
            count++;
          }
        }
      }

      return count;
    } catch (error) {
      console.error(`Error counting files in directory ${dirPath}:`, error);
      return 0;
    }
  }

  // Helper function to recursively index a directory and all its subdirectories (deep indexing)
  async function indexDirectory(dirPath, folderId, rootFolderPath, totalFiles, indexedFiles = 0, mainWindow = null) {
    try {
      // Check if the root folder is still being indexed before starting
      const rootPath = rootFolderPath || dirPath;
      if (!foldersBeingIndexed.some(f => f.folderPath === rootPath)) {
        console.log(`Stopping indexation for ${dirPath} because root folder ${rootPath} is no longer being indexed`);
        return { results: [], indexedFiles };
      }

      const results = [];
      // Use the root folder path for error logging, or the current directory if not provided
      const folderPathForLogging = rootFolderPath || dirPath;

      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Check again if the root folder is still being indexed before processing each entry
        if (!foldersBeingIndexed.some(f => f.folderPath === rootPath)) {
          console.log(`Stopping indexation for ${dirPath} because root folder ${rootPath} is no longer being indexed`);
          return { results, indexedFiles }; // Return any results collected so far
        }

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          try {
            // Recursively index subdirectory (this enables deep indexing of nested folders)
            const subResult = await indexDirectory(fullPath, folderId, rootPath, totalFiles, indexedFiles, mainWindow);
            results.push(...subResult.results);
            indexedFiles = subResult.indexedFiles;
          } catch (error) {
            console.error(`Error indexing subdirectory ${fullPath}:`, error);
            logIndexationError(folderPathForLogging, fullPath, error);
            // Continue with other entries despite this error
          }
        } else if (entry.isFile()) {
          // Index file
          const result = await indexFile(fullPath, folderId, folderPathForLogging);
          if (result) {
            results.push(result);
            indexedFiles++;

            // Send progress update to renderer process
            if (mainWindow && totalFiles > 0) {
              const progress = Math.round((indexedFiles / totalFiles) * 100);
              mainWindow.webContents.send('indexation-progress', {
                folderId,
                folderPath: rootPath,
                indexedFiles,
                totalFiles,
                progress
              });
            }
          }
        }
      }

      return { results, indexedFiles };
    } catch (error) {
      console.error(`Error indexing directory ${dirPath}:`, error);
      logIndexationError(rootFolderPath || dirPath, dirPath, error);
      return { results: [], indexedFiles };
    }
  }

  // Handler for indexing a single folder and all its subdirectories (deep indexing)
  ipcMain.handle('index-folder', async (event, folderPath) => {
    try {
      console.log(`Starting to index folder: ${folderPath}`);

      // Check if folder exists
      const stats = await fsPromises.stat(folderPath);
      if (!stats.isDirectory()) {
        return { success: false, error: 'Not a directory' };
      }

      // Generate a folder ID (in a real app, this would come from your database)
      const folderId = Date.now().toString();

      // Count total files before starting indexation
      console.log(`Counting files in folder: ${folderPath}`);
      const totalFiles = await countFiles(folderPath);
      console.log(`Found ${totalFiles} files in folder: ${folderPath}`);

      // Get the BrowserWindow that sent the request
      const mainWindow = BrowserWindow.fromWebContents(event.sender);

      // Send initial progress update
      if (mainWindow) {
        mainWindow.webContents.send('indexation-progress', {
          folderId,
          folderPath,
          indexedFiles: 0,
          totalFiles,
          progress: 0
        });
      }

      // Add to folders being indexed
      foldersBeingIndexed.push({ folderPath, folderId });

      try {
        // Index the directory with progress tracking
        const { results, indexedFiles } = await indexDirectory(folderPath, folderId, folderPath, totalFiles, 0, mainWindow);

        // Send final progress update
        if (mainWindow) {
          mainWindow.webContents.send('indexation-progress', {
            folderId,
            folderPath,
            indexedFiles,
            totalFiles,
            progress: totalFiles > 0 ? Math.round((indexedFiles / totalFiles) * 100) : 100
          });
        }

        // Remove from folders being indexed
        foldersBeingIndexed = foldersBeingIndexed.filter(f => f.folderPath !== folderPath);

        return {
          success: true,
          filesIndexed: indexedFiles,
          totalFiles,
          results: results,
          errorsCount: indexationErrorLog.errors.filter(e => e.folderPath === folderPath).length
        };
      } catch (error) {
        // Remove from folders being indexed in case of error
        foldersBeingIndexed = foldersBeingIndexed.filter(f => f.folderPath !== folderPath);
        throw error;
      }
    } catch (error) {
      console.error('Error in index-folder handler:', error);
      logIndexationError(folderPath, folderPath, error);
      return { success: false, error: error.toString() };
    }
  });

  // Handler for indexing multiple folders and all their subdirectories (deep indexing)
  ipcMain.handle('index-all-folders', async (event, folderPaths) => {
    try {
      console.log(`Starting to index ${folderPaths.length} folders`);

      const results = [];
      let totalFilesIndexed = 0;
      let totalErrorsCount = 0;

      for (const folderPath of folderPaths) {
        // Check if folder exists
        try {
          const stats = await fsPromises.stat(folderPath);
          if (!stats.isDirectory()) {
            console.warn(`Skipping ${folderPath}: Not a directory`);
            logIndexationError(folderPath, folderPath, new Error('Not a directory'));
            continue;
          }

          // Generate a folder ID (in a real app, this would come from your database)
          const folderId = Date.now().toString() + '-' + folderPaths.indexOf(folderPath);

          // Add to folders being indexed
          foldersBeingIndexed.push({ folderPath, folderId });

          try {
            // Index the directory
            const folderResults = await indexDirectory(folderPath, folderId, folderPath);
            totalFilesIndexed += folderResults.length;

            // Count errors for this folder
            const folderErrorsCount = indexationErrorLog.errors.filter(e => e.folderPath === folderPath).length;
            totalErrorsCount += folderErrorsCount;

            results.push({
              folderPath,
              filesIndexed: folderResults.length,
              errorsCount: folderErrorsCount,
              results: folderResults
            });
          } catch (error) {
            console.error(`Error indexing folder ${folderPath}:`, error);
            logIndexationError(folderPath, folderPath, error);
            results.push({
              folderPath,
              error: error.toString()
            });
            totalErrorsCount++;
          } finally {
            // Remove from folders being indexed regardless of success or failure
            foldersBeingIndexed = foldersBeingIndexed.filter(f => f.folderPath !== folderPath);
          }
        } catch (error) {
          console.error(`Error indexing folder ${folderPath}:`, error);
          logIndexationError(folderPath, folderPath, error);
          results.push({
            folderPath,
            error: error.toString()
          });
          totalErrorsCount++;
        }
      }

      return {
        success: true,
        totalFolders: folderPaths.length,
        totalFilesIndexed,
        totalErrorsCount,
        results
      };
    } catch (error) {
      console.error('Error in index-all-folders handler:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Handler for starting folder watching, including all subdirectories (deep watching)
  ipcMain.handle('start-watching-folders', async (event, folderPaths) => {
    try {
      console.log(`Scheduling watching of ${folderPaths.length} folders`);

      // Add a delay before starting watchers to prevent UI lag
      await new Promise(resolve => setTimeout(resolve, 3000));

      console.log(`Starting to watch ${folderPaths.length} folders after delay`);

      // Stop any existing watchers
      await stopAllWatchers();

      // Start new watchers for each folder with staggered delays
      for (let i = 0; i < folderPaths.length; i++) {
        const folderPath = folderPaths[i];

        // Add a staggered delay between starting each watcher (500ms per folder)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        try {
          // Check if folder exists
          const stats = await fsPromises.stat(folderPath);
          if (!stats.isDirectory()) {
            console.warn(`Skipping watch for ${folderPath}: Not a directory`);
            continue;
          }

          // Create a watcher for this folder and all its subdirectories (deep watching)
          // Optimized configuration to reduce lag
          const watcher = chokidar.watch(folderPath, {
            persistent: true,
            ignoreInitial: true,
            ignored: [
              /(^|[\/\\])\./, // Ignore hidden files
              // Ignore non-indexable file extensions upfront
              '**/*.{jpg,jpeg,png,gif,bmp,ico,svg,mp3,mp4,avi,mov,wmv,zip,rar,exe,dll,bin}',
              // Add more non-indexable extensions as needed
              '**/node_modules/**', // Ignore node_modules folders
              '**/build/**', // Ignore build folders
              '**/dist/**' // Ignore dist folders
            ],
            depth: 10, // Limit depth to a reasonable level
            awaitWriteFinish: {
              stabilityThreshold: 2000, // Wait for file to be stable for 2 seconds
              pollInterval: 100 // Poll every 100ms
            },
            usePolling: false, // Avoid polling when possible
            alwaysStat: false, // Don't stat files unnecessarily
            disableGlobbing: true // Disable globbing for better performance
          });

          // Create throttled and debounced handlers
          const throttledAddHandler = throttle((path) => {
            console.log(`File ${path} has been added`);
            // Queue the file for indexing
            queueFileForProcessing(path, folderId, folderPath, 'add');
          }, 300);

          const debouncedChangeHandler = debounce((path) => {
            console.log(`File ${path} has been changed`);
            // Queue the file for re-indexing
            queueFileForProcessing(path, folderId, folderPath, 'change');
          }, 500);

          const throttledUnlinkHandler = throttle((path) => {
            console.log(`File ${path} has been removed`);
            // Queue the file for removal from index
            queueFileForProcessing(path, folderId, folderPath, 'unlink');
          }, 300);

          // Handle file events with throttling and debouncing
          watcher.on('add', throttledAddHandler);
          watcher.on('change', debouncedChangeHandler);
          watcher.on('unlink', throttledUnlinkHandler);

          // Generate a consistent folder ID for this folder
          const folderId = Date.now().toString() + '-' + folderPath.replace(/[^a-zA-Z0-9]/g, '-');

          // Store the watcher with the folder ID
          folderWatchers.push({
            folderPath,
            folderId,
            watcher
          });

          console.log(`Now watching folder: ${folderPath}`);
        } catch (error) {
          console.error(`Error setting up watcher for ${folderPath}:`, error);
        }
      }

      return {
        success: true,
        watchingFolders: folderWatchers.length
      };
    } catch (error) {
      console.error('Error in start-watching-folders handler:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Helper function to stop watching a specific folder
  async function stopWatchingFolder(folderPath) {
    // Normalize the path to ensure consistent comparison
    const normalizedPath = path.normalize(folderPath);

    // Find the watcher for this folder
    const watcherIndex = folderWatchers.findIndex(w => path.normalize(w.folderPath) === normalizedPath);

    if (watcherIndex === -1) {
      console.log(`No watcher found for folder: ${folderPath}`);
      return false;
    }

    try {
      // Close the watcher
      await folderWatchers[watcherIndex].watcher.close();
      console.log(`Stopped watching folder: ${folderPath}`);

      // Remove the watcher from the array
      folderWatchers.splice(watcherIndex, 1);
      return true;
    } catch (error) {
      console.error(`Error stopping watcher for ${folderPath}:`, error);
      return false;
    }
  }

  // Helper function to stop all watchers
  async function stopAllWatchers() {
    for (const watcherInfo of folderWatchers) {
      try {
        await watcherInfo.watcher.close();
        console.log(`Stopped watching folder: ${watcherInfo.folderPath}`);
      } catch (error) {
        console.error(`Error stopping watcher for ${watcherInfo.folderPath}:`, error);
      }
    }
    folderWatchers = [];
  }

  // Handler for stopping folder watching
  ipcMain.handle('stop-watching-folders', async (event) => {
    try {
      console.log('Stopping all folder watchers');

      await stopAllWatchers();

      return { success: true };
    } catch (error) {
      console.error('Error in stop-watching-folders handler:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Handler for getting the indexation error log
  ipcMain.handle('get-indexation-error-log', async (event, folderPath) => {
    try {
      // If folderPath is provided, filter errors for that folder
      if (folderPath) {
        const folderErrors = indexationErrorLog.errors.filter(error => error.folderPath === folderPath);
        return {
          success: true,
          errors: folderErrors,
          lastUpdated: indexationErrorLog.lastUpdated,
          count: folderErrors.length
        };
      }

      // Otherwise return all errors
      return {
        success: true,
        errors: indexationErrorLog.errors,
        lastUpdated: indexationErrorLog.lastUpdated,
        count: indexationErrorLog.errors.length
      };
    } catch (error) {
      console.error('Error getting indexation error log:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Handler for clearing the indexation error log
  ipcMain.handle('clear-indexation-error-log', async (event, folderPath) => {
    try {
      // If folderPath is provided, clear only errors for that folder
      if (folderPath) {
        indexationErrorLog.errors = indexationErrorLog.errors.filter(error => error.folderPath !== folderPath);
        indexationErrorLog.lastUpdated = new Date();
        return {
          success: true,
          message: `Error log cleared for folder: ${folderPath}`,
          remainingCount: indexationErrorLog.errors.length
        };
      }

      // Otherwise clear all errors
      return clearIndexationErrorLog();
    } catch (error) {
      console.error('Error clearing indexation error log:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Handler for stopping indexation of a specific folder
  ipcMain.handle('stop-folder-indexation', async (event, folderPath) => {
    try {
      console.log(`Request to stop indexation for folder: ${folderPath}`);

      // Check if the folder is being indexed
      const isBeingIndexed = foldersBeingIndexed.some(f => f.folderPath === folderPath);

      if (isBeingIndexed) {
        console.log(`Stopping indexation for folder: ${folderPath}`);
        // Remove from folders being indexed
        foldersBeingIndexed = foldersBeingIndexed.filter(f => f.folderPath !== folderPath);
        return {
          success: true,
          message: `Indexation stopped for folder: ${folderPath}`
        };
      } else {
        console.log(`Folder not being indexed: ${folderPath}`);
        return {
          success: false,
          message: `Folder not being indexed: ${folderPath}`
        };
      }
    } catch (error) {
      console.error('Error stopping folder indexation:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Helper function to check if a folder is already indexed or is a subfolder of an indexed folder
  function isFolderIndexable(folderPath) {
    try {
      // Check if the path is a file (not a folder)
      const stats = fs.statSync(folderPath);
      if (!stats.isDirectory()) {
        return {
          indexable: false,
          reason: 'Not a directory'
        };
      }

      // Normalize the path to ensure consistent comparison
      const normalizedPath = path.normalize(folderPath);

      // Get all folders from folderWatchers
      const watchedFolders = folderWatchers.map(w => path.normalize(w.folderPath));

      // Check if the folder is already indexed
      if (watchedFolders.includes(normalizedPath)) {
        return {
          indexable: false,
          reason: 'Folder is already indexed'
        };
      }

      // Check if the folder is a subfolder of an indexed folder
      for (const watchedFolder of watchedFolders) {
        if (normalizedPath.startsWith(watchedFolder + path.sep) ||
            normalizedPath + path.sep === watchedFolder) {
          return {
            indexable: false,
            reason: `Folder is a subfolder of already indexed folder: ${watchedFolder}`
          };
        }
      }

      // Check if the folder contains an indexed folder
      for (const watchedFolder of watchedFolders) {
        if (watchedFolder.startsWith(normalizedPath + path.sep)) {
          return {
            indexable: false,
            reason: `Folder contains already indexed folder: ${watchedFolder}`
          };
        }
      }

      return { indexable: true };
    } catch (error) {
      console.error(`Error checking if folder is indexable: ${folderPath}`, error);
      return {
        indexable: false,
        reason: `Error checking folder: ${error.toString()}`
      };
    }
  }

  // Handler for checking if a folder can be added
  ipcMain.handle('check-folder-indexable', async (event, folderPath) => {
    try {
      console.log(`Checking if folder is indexable: ${folderPath}`);
      const result = isFolderIndexable(folderPath);
      return {
        success: true,
        ...result
      };
    } catch (error) {
      console.error('Error in check-folder-indexable handler:', error);
      return {
        success: false,
        indexable: false,
        reason: error.toString()
      };
    }
  });

  // Handler for removing a file from the index
  ipcMain.handle('remove-file-from-index', async (event, filePath, folderId) => {
    try {
      console.log(`Received request to remove file from index: ${filePath}`);

      // Call the removeFileFromIndex function
      const result = await removeFileFromIndex(filePath, folderId);

      return {
        success: true,
        file: result
      };
    } catch (error) {
      console.error('Error in remove-file-from-index handler:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Handler for removing a folder from the index
  ipcMain.handle('remove-folder-from-index', async (event, folderPath) => {
    try {
      console.log(`Received request to remove folder from index: ${folderPath}`);

      // First check if the folder is being indexed and stop indexation if needed
      const isBeingIndexed = foldersBeingIndexed.some(f => f.folderPath === folderPath);
      if (isBeingIndexed) {
        console.log(`Stopping indexation for folder: ${folderPath}`);
        // Remove from folders being indexed
        foldersBeingIndexed = foldersBeingIndexed.filter(f => f.folderPath !== folderPath);
      }

      // Stop watching the folder
      const watchingStopped = await stopWatchingFolder(folderPath);

      return {
        success: true,
        folderPath,
        watchingStopped,
        indexationStopped: isBeingIndexed
      };
    } catch (error) {
      console.error('Error in remove-folder-from-index handler:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Clean up watchers when app is quitting
  app.on('will-quit', async () => {
    await stopAllWatchers();
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
