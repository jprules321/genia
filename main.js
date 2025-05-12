const { app, BrowserWindow, ipcMain, dialog, Tray, Menu } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs');
const fsPromises = fs.promises;
const chokidar = require('chokidar');
const { v4: uuidv4 } = require('uuid');
const zlib = require('zlib');
const crypto = require('crypto');
const db = require('./db');

// Global watcher instance
let folderWatchers = [];

// Global variable to track folders being indexed
let foldersBeingIndexed = [];

// Global indexation error log
let indexationErrorLog = {
  errors: [],
  lastUpdated: null
};

// Global flag to track if indexation should continue for each folder
let folderIndexingStatus = new Map();

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

  // Filter out files for folders that are no longer being indexed
  const validBatch = batch.filter(item => {
    // Check if the folder is still being indexed
    const isBeingIndexed = foldersBeingIndexed.some(f => f.folderPath === item.folderPath);
    const isIndexingActive = !folderIndexingStatus.has(item.folderPath) || folderIndexingStatus.get(item.folderPath);

    return isBeingIndexed && isIndexingActive;
  });

  // Process the filtered batch
  for (const item of validBatch) {
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

  app.on('ready', async () => {
    // Debug application paths
    console.log('Application paths for debugging:');
    console.log('__dirname:', __dirname);
    console.log('app.getAppPath():', app.getAppPath());

    createWindow();
    createTray();

    // Note: We don't clear indexed files here anymore.
    // The renderer process handles this through the IndexingService.clearIndexedFilesIfNoFolders() method,
    // which properly checks if folders exist before clearing indexed files.
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

  // --- Enhanced IPC Communication Handlers ---

  // Map to store pending request handlers with their timeouts
  const pendingRequests = new Map();

  // IPC Middleware System
  const middlewareStack = [];

  // Constants for compression
  const COMPRESSION_THRESHOLD = 10 * 1024; // 10KB - only compress payloads larger than this
  const COMPRESSION_LEVEL = 6; // zlib compression level (0-9, where 9 is max compression)

  // Constants for security
  const HMAC_ALGORITHM = 'sha256'; // HMAC algorithm for message integrity
  const HMAC_KEY = process.env.IPC_HMAC_KEY || 'genia-secure-ipc-key'; // HMAC key (should be set via environment variable in production)

  /**
   * Middleware interface:
   * {
   *   name: string,                    // Name of the middleware for identification
   *   priority: number,                // Priority (lower numbers run first)
   *   processRequest: async (request, next) => {},  // Process individual requests
   *   processBatch: async (batchRequest, next) => {} // Process batch requests
   * }
   */

  /**
   * Register middleware for IPC message processing
   * @param {Object} middleware - The middleware object
   */
  function registerMiddleware(middleware) {
    if (!middleware.name) {
      console.error('Middleware must have a name');
      return;
    }

    // Default priority to 100 if not specified
    if (middleware.priority === undefined) {
      middleware.priority = 100;
    }

    // Add middleware to stack
    middlewareStack.push(middleware);

    // Sort middleware by priority (lower numbers run first)
    middlewareStack.sort((a, b) => a.priority - b.priority);

    console.log(`Registered middleware: ${middleware.name} (priority: ${middleware.priority})`);
  }

  /**
   * Run middleware chain for a request
   * @param {Object} request - The request to process
   * @returns {Promise<Object>} - The processed response
   */
  async function runMiddlewareChain(request, isRequestBatch = false) {
    let currentIndex = 0;

    // Create the next function that calls the next middleware in the chain
    const next = async (req) => {
      // If we've run out of middleware, return the request as is
      if (currentIndex >= middlewareStack.length) {
        return req;
      }

      const currentMiddleware = middlewareStack[currentIndex++];

      try {
        // Call the appropriate middleware function based on whether this is a batch request
        if (isRequestBatch && currentMiddleware.processBatch) {
          return await currentMiddleware.processBatch(req, next);
        } else if (!isRequestBatch && currentMiddleware.processRequest) {
          return await currentMiddleware.processRequest(req, next);
        } else {
          // Skip middleware that doesn't handle this type of request
          return await next(req);
        }
      } catch (error) {
        console.error(`Error in middleware ${currentMiddleware.name}:`, error);
        throw error;
      }
    };

    // Start the middleware chain
    return await next(request);
  }

  // Service registry for dynamic service discovery
  const serviceRegistry = new Map();

  /**
   * Register a service with the IPC service registry
   * @param {string} serviceName - The name of the service
   * @param {Object} serviceHandlers - Object containing service handler functions
   */
  function registerService(serviceName, serviceHandlers) {
    if (serviceRegistry.has(serviceName)) {
      console.warn(`Service ${serviceName} is already registered. Overwriting.`);
    }

    serviceRegistry.set(serviceName, serviceHandlers);
    console.log(`Registered service: ${serviceName}`);
  }

  /**
   * Get a service from the registry
   * @param {string} serviceName - The name of the service to retrieve
   * @returns {Object|null} - The service handlers or null if not found
   */
  function getService(serviceName) {
    return serviceRegistry.has(serviceName) ? serviceRegistry.get(serviceName) : null;
  }

  /**
   * List all registered services
   * @returns {Array<string>} - Array of service names
   */
  function listServices() {
    return Array.from(serviceRegistry.keys());
  }

  // Register built-in middleware

  // Security middleware
  registerMiddleware({
    name: 'security',
    priority: 20, // Run early in the chain, but after validation if implemented

    // Process individual requests
    processRequest: async (request, next) => {
      // Add a timestamp for replay protection
      if (!request.timestamp) {
        request.timestamp = Date.now();
      }

      // Generate HMAC for the request to verify integrity
      const requestData = JSON.stringify({
        id: request.id,
        channel: request.channel,
        timestamp: request.timestamp,
        // Don't include the payload in the HMAC if it's already compressed
        // as the compression middleware will run after this
        payload: request.compressed ? '[compressed]' : request.payload
      });

      // Calculate HMAC
      const hmac = crypto.createHmac(HMAC_ALGORITHM, HMAC_KEY)
        .update(requestData)
        .digest('hex');

      // Add HMAC to the request
      request.hmac = hmac;

      // Process the request through the rest of the middleware chain
      const processedRequest = await next(request);

      // Verify the response integrity if it has an HMAC
      if (processedRequest.hmac) {
        const responseData = JSON.stringify({
          id: processedRequest.id,
          requestId: processedRequest.requestId,
          timestamp: processedRequest.timestamp,
          success: processedRequest.success,
          // Don't include the payload in the HMAC verification if it's compressed
          payload: processedRequest.compressed ? '[compressed]' : processedRequest.payload
        });

        // Calculate expected HMAC
        const expectedHmac = crypto.createHmac(HMAC_ALGORITHM, HMAC_KEY)
          .update(responseData)
          .digest('hex');

        // Verify HMAC
        if (processedRequest.hmac !== expectedHmac) {
          console.error('Response integrity check failed: HMAC mismatch');
          processedRequest.error = 'Response integrity check failed';
          processedRequest.success = false;
        }
      }

      return processedRequest;
    },

    // Process batch requests
    processBatch: async (batchRequest, next) => {
      // Add a timestamp for replay protection
      if (!batchRequest.timestamp) {
        batchRequest.timestamp = Date.now();
      }

      // Generate HMAC for the batch request to verify integrity
      const batchRequestData = JSON.stringify({
        id: batchRequest.id,
        channel: batchRequest.channel,
        timestamp: batchRequest.timestamp,
        // Don't include the payloads in the HMAC if they're already compressed
        payloads: batchRequest.compressed ? '[compressed]' : batchRequest.payloads
      });

      // Calculate HMAC
      const hmac = crypto.createHmac(HMAC_ALGORITHM, HMAC_KEY)
        .update(batchRequestData)
        .digest('hex');

      // Add HMAC to the batch request
      batchRequest.hmac = hmac;

      // Process the batch request through the rest of the middleware chain
      const processedBatchRequest = await next(batchRequest);

      // Verify the batch response integrity if it has an HMAC
      if (processedBatchRequest.hmac) {
        const batchResponseData = JSON.stringify({
          id: processedBatchRequest.id,
          requestId: processedBatchRequest.requestId,
          timestamp: processedBatchRequest.timestamp,
          success: processedBatchRequest.success,
          // Don't include the payloads in the HMAC verification if they're compressed
          payloads: processedBatchRequest.compressed ? '[compressed]' : processedBatchRequest.payloads
        });

        // Calculate expected HMAC
        const expectedHmac = crypto.createHmac(HMAC_ALGORITHM, HMAC_KEY)
          .update(batchResponseData)
          .digest('hex');

        // Verify HMAC
        if (processedBatchRequest.hmac !== expectedHmac) {
          console.error('Batch response integrity check failed: HMAC mismatch');
          processedBatchRequest.errors = processedBatchRequest.errors || [];
          processedBatchRequest.errors.push('Batch response integrity check failed');
          processedBatchRequest.success = false;
        }
      }

      return processedBatchRequest;
    }
  });

  // Compression middleware
  registerMiddleware({
    name: 'compression',
    priority: 50, // Run after validation but before security

    // Process individual requests
    processRequest: async (request, next) => {
      // Check if the request has a payload that needs compression
      if (request.payload && !request.compressed) {
        const payloadSize = JSON.stringify(request.payload).length;

        // Only compress payloads larger than the threshold
        if (payloadSize > COMPRESSION_THRESHOLD) {
          try {
            // Convert payload to string
            const payloadStr = JSON.stringify(request.payload);

            // Compress the payload
            const compressedPayload = zlib.deflateSync(payloadStr, { level: COMPRESSION_LEVEL });

            // Update the request with compressed payload
            request.originalPayloadSize = payloadSize;
            request.payload = compressedPayload.toString('base64');
            request.compressed = true;

            console.log(`Compressed request payload: ${payloadSize} -> ${request.payload.length} bytes (${Math.round((request.payload.length / payloadSize) * 100)}%)`);
          } catch (error) {
            console.error('Error compressing request payload:', error);
            // Continue with uncompressed payload
          }
        }
      }

      // Process the request through the rest of the middleware chain
      const processedRequest = await next(request);

      // Check if the response has a compressed payload that needs decompression
      if (processedRequest.payload && processedRequest.compressed) {
        try {
          // Decompress the payload
          const compressedBuffer = Buffer.from(processedRequest.payload, 'base64');
          const decompressedPayload = zlib.inflateSync(compressedBuffer).toString();

          // Parse the decompressed payload back to an object
          processedRequest.payload = JSON.parse(decompressedPayload);
          processedRequest.compressed = false;

          console.log(`Decompressed response payload: ${compressedBuffer.length} -> ${decompressedPayload.length} bytes`);
        } catch (error) {
          console.error('Error decompressing response payload:', error);
          // Continue with compressed payload
        }
      }

      return processedRequest;
    },

    // Process batch requests
    processBatch: async (batchRequest, next) => {
      // Check if the batch request has payloads that need compression
      if (batchRequest.payloads && Array.isArray(batchRequest.payloads) && !batchRequest.compressed) {
        const totalSize = JSON.stringify(batchRequest.payloads).length;

        // Only compress if the total size is above the threshold
        if (totalSize > COMPRESSION_THRESHOLD) {
          try {
            // Convert payloads to string
            const payloadsStr = JSON.stringify(batchRequest.payloads);

            // Compress the payloads
            const compressedPayloads = zlib.deflateSync(payloadsStr, { level: COMPRESSION_LEVEL });

            // Update the batch request with compressed payloads
            batchRequest.originalPayloadsSize = totalSize;
            batchRequest.payloads = compressedPayloads.toString('base64');
            batchRequest.compressed = true;

            console.log(`Compressed batch payloads: ${totalSize} -> ${batchRequest.payloads.length} bytes (${Math.round((batchRequest.payloads.length / totalSize) * 100)}%)`);
          } catch (error) {
            console.error('Error compressing batch payloads:', error);
            // Continue with uncompressed payloads
          }
        }
      }

      // Process the batch request through the rest of the middleware chain
      const processedBatchRequest = await next(batchRequest);

      // Check if the batch response has compressed payloads that need decompression
      if (processedBatchRequest.payloads && processedBatchRequest.compressed) {
        try {
          // Decompress the payloads
          const compressedBuffer = Buffer.from(processedBatchRequest.payloads, 'base64');
          const decompressedPayloads = zlib.inflateSync(compressedBuffer).toString();

          // Parse the decompressed payloads back to an array
          processedBatchRequest.payloads = JSON.parse(decompressedPayloads);
          processedBatchRequest.compressed = false;

          console.log(`Decompressed batch payloads: ${compressedBuffer.length} -> ${decompressedPayloads.length} bytes`);
        } catch (error) {
          console.error('Error decompressing batch payloads:', error);
          // Continue with compressed payloads
        }
      }

      return processedBatchRequest;
    }
  });

  // Process a request and send back a response
  async function processRequest(request) {
    // Run the request through the middleware chain
    try {
      request = await runMiddlewareChain(request, false);
    } catch (error) {
      console.error('Error in middleware chain:', error);
      // Continue with the original request if middleware fails
    }

    const { id, channel, payload, timeout } = request;

    // Create response object
    const response = {
      id: uuidv4(),
      requestId: id,
      timestamp: Date.now(),
      success: false,
      payload: null
    };

    try {
      // Set up timeout if specified
      let timeoutId = null;
      if (timeout) {
        timeoutId = setTimeout(() => {
          // If the request is still pending, reject it with a timeout error
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            response.error = `Request timed out after ${timeout}ms`;
            mainWindow.webContents.send('ipc-response', response);
          }
        }, timeout);

        // Store the timeout ID so we can clear it if the request completes
        pendingRequests.set(id, timeoutId);
      }

      // Process the request based on the channel
      let result;
      switch (channel) {
        case 'minimize-window':
          if (mainWindow) mainWindow.minimize();
          result = { success: true };
          break;

        case 'maximize-window':
          if (mainWindow) {
            if (mainWindow.isMaximized()) {
              mainWindow.unmaximize();
            } else {
              mainWindow.maximize();
            }
          }
          result = { success: true, maximized: mainWindow ? mainWindow.isMaximized() : false };
          break;

        case 'close-window':
          if (mainWindow) {
            if (!app.isQuitting) {
              mainWindow.hide();
            } else {
              mainWindow.close();
            }
          }
          result = { success: true };
          break;

        case 'is-window-maximized':
          result = { success: true, maximized: mainWindow ? mainWindow.isMaximized() : false };
          break;

        case 'echo':
          // Simple echo handler for testing
          result = {
            success: true,
            echo: payload,
            timestamp: Date.now(),
            received: true
          };
          break;

        case 'show-open-dialog':
          if (!mainWindow) {
            result = { success: false, error: 'Main window not available' };
          } else {
            const dialogResult = await dialog.showOpenDialog(mainWindow, payload);
            result = { success: true, ...dialogResult };
          }
          break;

        case 'index-folder':
          result = await indexFolder(payload);
          break;

        case 'index-all-folders':
          result = await indexAllFolders(payload);
          break;

        // Add cases for all other existing IPC handlers

        default:
          result = { success: false, error: `Unknown channel: ${channel}` };
      }

      // Clear the timeout if it was set
      if (timeoutId) {
        clearTimeout(timeoutId);
        pendingRequests.delete(id);
      }

      // Send the response
      response.success = result.success !== false; // Default to true if not explicitly false
      delete result.success; // Remove success from the payload
      response.payload = result;

      if (!response.success && result.error) {
        response.error = result.error;
      }

    } catch (error) {
      console.error(`Error processing request on channel ${channel}:`, error);
      response.success = false;
      response.error = error.message || 'Unknown error';

      // Clear the timeout if it was set
      if (pendingRequests.has(id)) {
        clearTimeout(pendingRequests.get(id));
        pendingRequests.delete(id);
      }
    }

    // Send the response back to the renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ipc-response', response);
    }

    return response;
  }

  // Process a batch of requests
  async function processBatchRequest(batchRequest) {
    // Run the batch request through the middleware chain
    try {
      batchRequest = await runMiddlewareChain(batchRequest, true);
    } catch (error) {
      console.error('Error in middleware chain for batch request:', error);
      // Continue with the original batch request if middleware fails
    }

    const { id, channel, payloads, timeout } = batchRequest;

    // Create batch response object
    const batchResponse = {
      id: uuidv4(),
      requestId: id,
      timestamp: Date.now(),
      success: true,
      payloads: [],
      errors: []
    };

    try {
      // Set up timeout if specified
      let timeoutId = null;
      if (timeout) {
        timeoutId = setTimeout(() => {
          // If the batch request is still pending, reject it with a timeout error
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            batchResponse.success = false;
            batchResponse.errors = [`Batch request timed out after ${timeout}ms`];
            mainWindow.webContents.send('ipc-batch-response', batchResponse);
          }
        }, timeout);

        // Store the timeout ID so we can clear it if the request completes
        pendingRequests.set(id, timeoutId);
      }

      // Process each payload in the batch
      for (const payload of payloads) {
        try {
          // Create a single request for this payload
          const singleRequest = {
            id: uuidv4(),
            timestamp: Date.now(),
            channel,
            payload
          };

          // Process the request
          const response = await processRequest(singleRequest);

          // Add the response payload to the batch response
          batchResponse.payloads.push(response.payload);

          // If any request fails, mark the batch as failed
          if (!response.success) {
            batchResponse.success = false;
            batchResponse.errors.push(response.error || 'Unknown error');
          }
        } catch (error) {
          console.error(`Error processing batch item:`, error);
          batchResponse.success = false;
          batchResponse.errors.push(error.message || 'Unknown error');
          batchResponse.payloads.push(null);
        }
      }

      // Clear the timeout if it was set
      if (timeoutId) {
        clearTimeout(timeoutId);
        pendingRequests.delete(id);
      }

    } catch (error) {
      console.error(`Error processing batch request:`, error);
      batchResponse.success = false;
      batchResponse.errors = [error.message || 'Unknown error'];

      // Clear the timeout if it was set
      if (pendingRequests.has(id)) {
        clearTimeout(pendingRequests.get(id));
        pendingRequests.delete(id);
      }
    }

    // Send the batch response back to the renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ipc-batch-response', batchResponse);
    }

    return batchResponse;
  }

  // Handle IPC requests
  ipcMain.handle('ipc-request', async (event, request) => {
    return await processRequest(request);
  });

  // Handle one-way IPC messages (no response)
  ipcMain.on('ipc-one-way', (event, request) => {
    // Process the request but don't send a response
    processRequest(request).catch(error => {
      console.error('Error processing one-way request:', error);
    });
  });

  // Handle batch IPC requests
  ipcMain.handle('ipc-batch-request', async (event, batchRequest) => {
    return await processBatchRequest(batchRequest);
  });

  // --- Service Registry Handlers ---

  // Handle service discovery requests
  ipcMain.handle('get-service', async (event, serviceName) => {
    const service = getService(serviceName);
    return {
      success: !!service,
      serviceName,
      exists: !!service,
      methods: service ? Object.keys(service) : []
    };
  });

  // Handle service list requests
  ipcMain.handle('list-services', async (event) => {
    const services = listServices();
    return {
      success: true,
      services
    };
  });

  // Handle service method invocation
  ipcMain.handle('invoke-service-method', async (event, request) => {
    const { serviceName, methodName, args } = request;

    // Get the service
    const service = getService(serviceName);
    if (!service) {
      return {
        success: false,
        error: `Service '${serviceName}' not found`
      };
    }

    // Check if the method exists
    if (!service[methodName] || typeof service[methodName] !== 'function') {
      return {
        success: false,
        error: `Method '${methodName}' not found in service '${serviceName}'`
      };
    }

    try {
      // Invoke the method
      const result = await service[methodName](...(args || []));
      return {
        success: true,
        result
      };
    } catch (error) {
      console.error(`Error invoking service method ${serviceName}.${methodName}:`, error);
      return {
        success: false,
        error: error.message || 'Unknown error'
      };
    }
  });

  // --- Register Example Services ---

  // Register a system info service
  registerService('systemInfo', {
    getAppVersion: () => app.getVersion(),
    getPlatform: () => process.platform,
    getArch: () => process.arch,
    getNodeVersion: () => process.versions.node,
    getElectronVersion: () => process.versions.electron,
    getChromeVersion: () => process.versions.chrome,
    getMemoryUsage: () => process.memoryUsage(),
    getCPUUsage: async () => {
      return new Promise((resolve) => {
        process.cpuUsage((cpuUsage) => {
          resolve(cpuUsage);
        });
      });
    }
  });

  // Register a file system service
  registerService('fileSystem', {
    readFile: async (filePath) => {
      try {
        return await fsPromises.readFile(filePath, 'utf8');
      } catch (error) {
        throw new Error(`Failed to read file: ${error.message}`);
      }
    },
    writeFile: async (filePath, content) => {
      try {
        await fsPromises.writeFile(filePath, content, 'utf8');
        return { success: true };
      } catch (error) {
        throw new Error(`Failed to write file: ${error.message}`);
      }
    },
    listDirectory: async (directoryPath) => {
      try {
        const files = await fsPromises.readdir(directoryPath);
        const fileStats = await Promise.all(
          files.map(async (file) => {
            const fullPath = path.join(directoryPath, file);
            const stats = await fsPromises.stat(fullPath);
            return {
              name: file,
              path: fullPath,
              isDirectory: stats.isDirectory(),
              size: stats.size,
              created: stats.birthtime,
              modified: stats.mtime
            };
          })
        );
        return fileStats;
      } catch (error) {
        throw new Error(`Failed to list directory: ${error.message}`);
      }
    }
  });

  // Register a database service
  registerService('database', {
    getStats: async () => {
      try {
        const stats = await db.getStats();
        return stats;
      } catch (error) {
        throw new Error(`Failed to get database stats: ${error.message}`);
      }
    },
    runQuery: async (query, params) => {
      try {
        // This is just an example - in a real app, you'd want to validate and sanitize queries
        const result = await db.runQuery(query, params);
        return result;
      } catch (error) {
        throw new Error(`Failed to run query: ${error.message}`);
      }
    }
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

  // Queue for batching file save messages to renderer
  let fileSaveQueue = [];
  let fileSaveTimer = null;
  const FILE_SAVE_BATCH_SIZE = 250;
  const FILE_SAVE_BATCH_DELAY = 1000; // 1 second

  // Process file save queue
  async function processFileSaveQueue() {
    if (fileSaveQueue.length === 0) {
      fileSaveTimer = null;
      return;
    }

    // Take a batch of files to save
    const batch = fileSaveQueue.splice(0, FILE_SAVE_BATCH_SIZE);

    // Filter out files for folders that are no longer being indexed
    const validBatch = batch.filter(file => {
      // Extract folderPath from the file object
      const folderPath = file.folderPath || '';
      if (!folderPath) return false;

      // Check if the folder is still being indexed
      const isBeingIndexed = foldersBeingIndexed.some(f => f.folderPath === folderPath);
      const isIndexingActive = !folderIndexingStatus.has(folderPath) || folderIndexingStatus.get(folderPath);

      return isBeingIndexed && isIndexingActive;
    });

    // If no valid files to save, skip this batch
    if (validBatch.length === 0) {
      // console.log('No valid files to save in this batch (folders no longer being indexed)');

      // Schedule next batch if there are more files
      if (fileSaveQueue.length > 0) {
        fileSaveTimer = setTimeout(processFileSaveQueue, FILE_SAVE_BATCH_DELAY);
      } else {
        fileSaveTimer = null;
      }
      return;
    }

    try {
      // Save batch to SQLite database
      const result = await db.saveIndexedFilesBatch(validBatch);
      console.log(`Saved ${result.count} files to database (${result.errors} errors)`);

      // Send notification to renderer process about the batch save
      // This is just for progress tracking, not for storing the data
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        // Group files by folder to provide more detailed progress information
        const folderCounts = {};
        validBatch.forEach(file => {
          const folderPath = file.folderPath || '';
          if (!folderPath) return;

          if (!folderCounts[folderPath]) {
            folderCounts[folderPath] = {
              folderId: file.folderId,
              count: 0
            };
          }
          folderCounts[folderPath].count++;
        });

        mainWindow.webContents.send('save-indexed-files-batch', {
          filesCount: result.count,
          errorsCount: result.errors,
          folderCounts: folderCounts
        });
      }
    } catch (error) {
      console.error('Error saving batch to database:', error);
    }

    // Schedule next batch if there are more files
    if (fileSaveQueue.length > 0) {
      fileSaveTimer = setTimeout(processFileSaveQueue, FILE_SAVE_BATCH_DELAY);
    } else {
      fileSaveTimer = null;
    }
  }

  // Helper function to index a single file
  async function indexFile(filePath, folderId, folderPath) {
    try {
      if (!shouldIndexFile(filePath)) {
        return null;
      }

      // Read file content with optimized error handling
      let content;
      let stats;

      try {
        // Get file stats first (smaller operation)
        stats = await fsPromises.stat(filePath);

        // Skip very large files (e.g., over 10MB) to prevent memory issues
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
        if (stats.size > MAX_FILE_SIZE) {
          logIndexationError(folderPath, filePath, new Error(`File too large (${stats.size} bytes)`));
          return null;
        }

        // Read file content
        content = await readFile(filePath);
      } catch (error) {
        logIndexationError(folderPath, filePath, error);
        return null;
      }

      if (content === null) {
        logIndexationError(folderPath, filePath, new Error('Failed to read file content'));
        return null;
      }

      // Create the file info object
      const fileInfo = {
        path: filePath,
        filename: path.basename(filePath),
        size: stats.size,
        lastModified: stats.mtime,
        indexed: true
      };

      // Add file to save queue instead of sending immediately
      fileSaveQueue.push({
        id: Date.now().toString() + '-' + path.basename(filePath).replace(/[^a-zA-Z0-9]/g, '-'),
        folderId: folderId,
        folderPath: folderPath, // Ensure folderPath is included for filtering
        path: filePath,
        filename: path.basename(filePath),
        content: content,
        lastIndexed: new Date(),
        lastModified: stats.mtime
      });

      // Start queue processing if not already running
      if (fileSaveTimer === null) {
        fileSaveTimer = setTimeout(processFileSaveQueue, FILE_SAVE_BATCH_DELAY);
      }

      return fileInfo;
    } catch (error) {
      // Reduced logging - only log to error log, not console
      logIndexationError(folderPath, filePath, error);
      return null;
    }
  }

  // Helper function to remove a file from the index
  async function removeFileFromIndex(filePath, folderId, folderPath) {
    try {
      console.log(`Removing file from index: ${filePath}`);

      // Remove the file from the SQLite database
      const result = await db.removeFileFromIndex(filePath, folderId);

      // If the file was removed successfully, notify the renderer process
      // This is just for UI updates, not for data storage
      if (result.removed) {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
          mainWindow.webContents.send('remove-indexed-file', {
            filePath: filePath,
            folderId: folderId,
            success: true
          });
        }
      }

      return {
        path: filePath,
        filename: path.basename(filePath),
        removed: result.removed,
        count: result.count
      };
    } catch (error) {
      console.error(`Error removing file ${filePath} from index:`, error);
      // Log the error but don't stop the process
      logIndexationError(folderPath, filePath, error);

      // Notify the renderer process of the error
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('remove-indexed-file', {
          filePath: filePath,
          folderId: folderId,
          success: false,
          error: error.toString()
        });
      }

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

  // Throttle function for progress updates
  const throttleProgressUpdates = throttle((mainWindow, data) => {
    if (mainWindow) {
      mainWindow.webContents.send('indexation-progress', data);
    }
  }, 500); // Only send updates every 500ms

  // Helper function to recursively index a directory and all its subdirectories (deep indexing)
  async function indexDirectory(dirPath, folderId, rootFolderPath, totalFiles, indexedFiles = 0, mainWindow = null) {
    try {
      // Check if the root folder is still being indexed before starting
      const rootPath = rootFolderPath || dirPath;

      // Check both the foldersBeingIndexed array and the folderIndexingStatus map
      if (!foldersBeingIndexed.some(f => f.folderPath === rootPath) ||
          (folderIndexingStatus.has(rootPath) && !folderIndexingStatus.get(rootPath))) {
        // Reduced logging
        return { results: [], indexedFiles };
      }

      const results = [];
      // Use the root folder path for error logging, or the current directory if not provided
      const folderPathForLogging = rootFolderPath || dirPath;

      // Read directory entries
      const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

      // Process entries in batches to avoid blocking the main thread
      const BATCH_SIZE = 100;
      let i = 0;
      let lastProgressUpdate = 0;

      while (i < entries.length) {
        // Check if indexation should continue before processing each batch
        if (!foldersBeingIndexed.some(f => f.folderPath === rootPath) ||
            (folderIndexingStatus.has(rootPath) && !folderIndexingStatus.get(rootPath))) {
          return { results, indexedFiles }; // Return any results collected so far
        }

        // Process a batch of entries
        const batchEnd = Math.min(i + BATCH_SIZE, entries.length);
        const batch = entries.slice(i, batchEnd);
        i = batchEnd;

        // Process each entry in the batch
        for (const entry of batch) {
          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory()) {
            try {
              // Recursively index subdirectory (this enables deep indexing of nested folders)
              const subResult = await indexDirectory(fullPath, folderId, rootPath, totalFiles, indexedFiles, mainWindow);
              results.push(...subResult.results);
              indexedFiles = subResult.indexedFiles;
            } catch (error) {
              // Reduced logging - only log to error log, not console
              logIndexationError(folderPathForLogging, fullPath, error);
            }
          } else if (entry.isFile()) {
            // Index file
            const result = await indexFile(fullPath, folderId, folderPathForLogging);
            if (result) {
              results.push(result);
              indexedFiles++;

              // Throttle progress updates to avoid overwhelming the UI
              if (mainWindow && totalFiles > 0) {
                const progress = Math.round((indexedFiles / totalFiles) * 100);

                // Only send progress updates if significant progress has been made (at least 1% change)
                // or if it's been a while since the last update
                const now = Date.now();
                if (progress > lastProgressUpdate || now - lastProgressUpdate >= 500) {
                  lastProgressUpdate = progress;
                  throttleProgressUpdates(mainWindow, {
                    folderId,
                    folderPath: rootPath,
                    indexedFiles,
                    totalFiles,
                    progress,
                    status: 'indexing'
                  });
                }
              }
            }
          }
        }

        // Yield to the event loop to prevent blocking
        await new Promise(resolve => setTimeout(resolve, 0));
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

      // Set indexing status to true for this folder
      folderIndexingStatus.set(folderPath, true);
      console.log(`Set indexing status to true for folder: ${folderPath}`);

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
            progress: totalFiles > 0 ? Math.round((indexedFiles / totalFiles) * 100) : 100,
            status: 'indexed'
          });
        }

        // Remove from folders being indexed
        foldersBeingIndexed = foldersBeingIndexed.filter(f => f.folderPath !== folderPath);

        // Clear indexing status for this folder
        folderIndexingStatus.delete(folderPath);
        console.log(`Cleared indexing status for folder: ${folderPath}`);

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

        // Clear indexing status for this folder
        folderIndexingStatus.delete(folderPath);
        console.log(`Cleared indexing status for folder: ${folderPath} due to error`);

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

          // Set indexing status to true for this folder
          folderIndexingStatus.set(folderPath, true);
          console.log(`Set indexing status to true for folder: ${folderPath}`);

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

            // Clear indexing status for this folder
            folderIndexingStatus.delete(folderPath);
            console.log(`Cleared indexing status for folder: ${folderPath} after indexing`);
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

          // Get indexed files for this folder
          console.log(`Getting indexed files for folder: ${folderPath}`);

          // Create a promise that will be resolved when we get a response from the renderer process
          const indexedFilesPromise = new Promise((resolve) => {
            // Set up a one-time listener for the response
            ipcMain.once('indexed-files-response', (event, response) => {
              resolve(response);
            });

            // Send a message to the renderer process to get the indexed files
            const mainWindow = BrowserWindow.fromWebContents(event.sender);
            if (mainWindow) {
              mainWindow.webContents.send('get-indexed-files', { folderPath });
            } else {
              resolve({ success: false, error: 'No window found', files: [] });
            }
          });

          // Wait for the indexed files
          const indexedFilesResponse = await indexedFilesPromise;

          // Check if we got a successful response
          if (!indexedFilesResponse.success) {
            console.error(`Error getting indexed files for folder: ${folderPath}`, indexedFilesResponse.error);
            continue; // Skip this folder
          }

          // Get the list of indexed files
          const indexedFiles = indexedFilesResponse.files || [];
          console.log(`Found ${indexedFiles.length} indexed files for folder: ${folderPath}`);

          // If no indexed files, skip this folder
          if (indexedFiles.length === 0) {
            console.log(`No indexed files found for folder: ${folderPath}, skipping`);
            continue;
          }

          // Create a watcher for only the indexed files in this folder
          // Optimized configuration to reduce lag
          const watcher = chokidar.watch(indexedFiles.map(file => file.path), {
            persistent: true,
            ignoreInitial: true,
            depth: 0, // Don't watch subdirectories, only the specific files
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
      const folderBeingIndexed = foldersBeingIndexed.find(f => f.folderPath === folderPath);
      const isBeingIndexed = !!folderBeingIndexed;

      if (isBeingIndexed) {
        console.log(`Stopping indexation for folder: ${folderPath}`);

        // Set indexing status to false for this folder to stop the indexation process
        folderIndexingStatus.set(folderPath, false);
        console.log(`Set indexing status to false for folder: ${folderPath}`);

        // Get the BrowserWindow that sent the request
        const mainWindow = BrowserWindow.fromWebContents(event.sender);

        // Send a progress update with status "stopped"
        if (mainWindow) {
          // Get the current progress before stopping
          const folderId = folderBeingIndexed.folderId;
          mainWindow.webContents.send('indexation-progress', {
            folderId,
            folderPath,
            indexedFiles: 0, // We don't know how many files were indexed
            totalFiles: 0,   // We don't know the total files
            progress: -1,    // Use -1 to indicate stopped status
            status: 'stopped'
          });
        }

        // Remove from folders being indexed
        foldersBeingIndexed = foldersBeingIndexed.filter(f => f.folderPath !== folderPath);

        // Wait a short time to allow the indexation process to stop gracefully
        await new Promise(resolve => setTimeout(resolve, 500));

        // Clear indexing status for this folder after a delay
        folderIndexingStatus.delete(folderPath);
        console.log(`Cleared indexing status for folder: ${folderPath} after stopping`);

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

      // Validate folderPath
      if (!folderPath) {
        console.error('Invalid folder path received:', folderPath);
        return {
          success: false,
          error: 'Invalid folder path',
          folderPath
        };
      }

      // First check if the folder is being indexed and stop indexation if needed
      const isBeingIndexed = foldersBeingIndexed.some(f => f.folderPath === folderPath);
      if (isBeingIndexed) {
        console.log(`Stopping indexation for folder: ${folderPath}`);
        // Remove from folders being indexed
        foldersBeingIndexed = foldersBeingIndexed.filter(f => f.folderPath !== folderPath);
      }

      // Stop watching the folder
      const watchingStopped = await stopWatchingFolder(folderPath);
      console.log(`Folder watching stopped: ${watchingStopped}`);

      // Get the folder ID from the renderer process
      const mainWindow = BrowserWindow.fromWebContents(event.sender);
      if (!mainWindow) {
        console.error('No main window found for event sender');
        return {
          success: false,
          error: 'No window found',
          folderPath,
          watchingStopped,
          indexationStopped: isBeingIndexed
        };
      }

      console.log(`Requesting folder ID for path: ${folderPath}`);

      // Create a promise that will be resolved when we get the folder ID from the renderer process
      const folderIdPromise = new Promise((resolve) => {
        // Set up a one-time listener for the folder ID response
        ipcMain.once('folder-id-response', (event, response) => {
          console.log(`Received folder ID response:`, response);
          resolve(response);
        });

        // Send a message to the renderer process to get the folder ID
        mainWindow.webContents.send('get-folder-id', { folderPath });
      });

      // Wait for the folder ID with a timeout
      let folderIdResponse;
      try {
        // Add a timeout to the promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout waiting for folder ID')), 15000);
        });

        folderIdResponse = await Promise.race([folderIdPromise, timeoutPromise]);
      } catch (timeoutError) {
        console.error('Timeout waiting for folder ID response:', timeoutError);
        return {
          success: false,
          error: 'Timeout waiting for folder ID',
          folderPath,
          watchingStopped,
          indexationStopped: isBeingIndexed
        };
      }

      let filesRemoved = 0;

      if (folderIdResponse && folderIdResponse.success && folderIdResponse.folderId) {
        // Remove all files for this folder from the database
        const folderId = folderIdResponse.folderId;
        console.log(`Removing files from database for folder ID: ${folderId}`);

        try {
          const result = await db.removeFolderFromIndex(folderId);
          filesRemoved = result.count;
          console.log(`Removed ${filesRemoved} files from database for folder: ${folderPath}`);
        } catch (dbError) {
          console.error(`Error removing files from database for folder ${folderPath}:`, dbError);
          // Continue with the operation even if database removal fails
        }
      } else {
        console.warn(`Invalid folder ID response:`, folderIdResponse);
      }

      console.log(`Folder removal from index completed successfully`);
      return {
        success: true,
        folderPath,
        watchingStopped,
        indexationStopped: isBeingIndexed,
        filesRemoved
      };
    } catch (error) {
      console.error('Error in remove-folder-from-index handler:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Handler for getting indexed files for a folder
  ipcMain.handle('get-indexed-files-for-folder', async (event, folderPath) => {
    try {
      console.log(`Getting indexed files for folder: ${folderPath}`);

      // First, we need to find the folder ID for this folder path
      // This is still handled by the renderer process since folder IDs are stored there
      const mainWindow = BrowserWindow.fromWebContents(event.sender);
      if (!mainWindow) {
        return { success: false, error: 'No window found', files: [] };
      }

      // Create a promise that will be resolved when we get the folder ID from the renderer process
      const folderIdPromise = new Promise((resolve) => {
        // Set up a one-time listener for the folder ID response
        ipcMain.once('folder-id-response', (event, response) => {
          resolve(response);
        });

        // Send a message to the renderer process to get the folder ID
        mainWindow.webContents.send('get-folder-id', { folderPath });
      });

      // Wait for the folder ID
      const folderIdResponse = await folderIdPromise;

      if (!folderIdResponse.success || !folderIdResponse.folderId) {
        return {
          success: false,
          error: folderIdResponse.error || 'Folder ID not found',
          files: []
        };
      }

      // Now that we have the folder ID, get the indexed files from the database
      const folderId = folderIdResponse.folderId;
      const files = await db.getIndexedFilesForFolder(folderId);

      // Return only the necessary file information (not the full content)
      const fileInfos = files.map(file => ({
        path: file.path,
        filename: file.filename,
        lastModified: file.lastModified
      }));

      return {
        success: true,
        files: fileInfos,
        folderPath: folderPath,
        folderId: folderId
      };
    } catch (error) {
      console.error('Error getting indexed files for folder:', error);
      return { success: false, error: error.toString(), files: [] };
    }
  });

  // Handler for sending indexed files response back to main process
  ipcMain.handle('send-indexed-files-response', async (event, response) => {
    try {
      console.log(`Received indexed files response for folder: ${response.folderPath}`);

      // Emit the response event to resolve the promise in the get-indexed-files-for-folder handler
      // Use ipcMain.emit instead of event.sender.send to ensure the event is emitted within the main process
      ipcMain.emit('indexed-files-response', event, response);

      return { success: true };
    } catch (error) {
      console.error('Error sending indexed files response:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Handler for sending folder ID response back to main process
  ipcMain.handle('send-folder-id-response', async (event, response) => {
    try {
      console.log(`Received folder ID response for folder: ${response.folderPath}`);

      // Emit the response event to resolve the promise in handlers that need folder ID
      // Use ipcMain.emit instead of event.sender.send to ensure the event is emitted within the main process
      ipcMain.emit('folder-id-response', event, response);

      return { success: true };
    } catch (error) {
      console.error('Error sending folder ID response:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Handler for opening a directory in the file explorer
  ipcMain.handle('open-directory', async (event, directoryPath) => {
    try {
      console.log(`Opening directory in file explorer: ${directoryPath}`);

      // Check if directory exists
      const stats = await fsPromises.stat(directoryPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          error: 'Not a directory'
        };
      }

      // Open directory in file explorer
      const { shell } = require('electron');
      await shell.openPath(directoryPath);

      return {
        success: true,
        message: `Directory opened: ${directoryPath}`
      };
    } catch (error) {
      console.error('Error opening directory:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Handler for getting the database path
  ipcMain.handle('get-database-path', async (event) => {
    try {
      // Get the user data directory
      const userDataPath = app.getPath('userData');
      const dbDir = path.join(userDataPath, 'database');
      const dbPath = path.join(dbDir, 'indexed_files.db');

      return {
        success: true,
        dbPath: dbPath,
        dbDir: dbDir
      };
    } catch (error) {
      console.error('Error getting database path:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Handler for clearing all indexed files
  ipcMain.handle('clear-all-indexed-files', async (event) => {
    try {
      console.log('Clearing all indexed files from database');

      const result = await db.clearAllIndexedFiles();

      console.log(`Cleared ${result.count} indexed files from database`);

      return {
        success: true,
        count: result.count
      };
    } catch (error) {
      console.error('Error clearing all indexed files:', error);
      return { success: false, error: error.toString() };
    }
  });

  // Clean up watchers and close database when app is quitting
  app.on('will-quit', async () => {
    await stopAllWatchers();

    // Close the database connection
    try {
      await db.closeDatabase();
      console.log('Database connection closed.');
    } catch (error) {
      console.error('Error closing database:', error);
    }
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
