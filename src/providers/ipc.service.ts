import { Injectable } from '@angular/core';
import { Observable, Subject, throwError, from, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { ElectronWindowService, IndexationProgressUpdate, IndexedFilesBatch } from './electron-window.service';
import {
  IPCMessage,
  IPCResponse,
  createIPCMessage,
  createIPCResponse,
  validateIPCMessage,
  validateIPCResponse,
  logIPCMessage,
  logIPCResponse
} from './ipc-message';

/**
 * Enhanced IPC Service
 *
 * This service wraps the ElectronWindowService to provide standardized IPC communication
 * with improved error handling, validation, and logging.
 */
@Injectable({
  providedIn: 'root'
})
export class IPCService {
  // Forward the observables from ElectronWindowService
  public indexationProgress$: Observable<IndexationProgressUpdate>;
  public indexedFilesBatch$: Observable<IndexedFilesBatch>;

  constructor(private electronService: ElectronWindowService) {
    this.indexationProgress$ = this.electronService.indexationProgress$;
    this.indexedFilesBatch$ = this.electronService.indexedFilesBatch$;
  }

  /**
   * Send an IPC message to the main process and get a response
   *
   * @param channel The channel to send the message on
   * @param data The data to send
   * @returns An observable that emits the response
   */
  private sendIPCMessage<T = any, R = any>(channel: string, data: T): Observable<R> {
    // Create a standardized IPC message
    const message = createIPCMessage(channel, data);

    // Log the outgoing message
    logIPCMessage('send', message);

    // Send the message to the main process and convert the promise to an observable
    return from(this.invokeElectronMethod(channel, data)).pipe(
      tap(response => {
        // Validate the response
        if (!validateIPCResponse(response)) {
          console.error(`Invalid IPC response received from channel ${channel}:`, response);
          throw new Error(`Invalid IPC response format from channel ${channel}`);
        }

        // Log the response
        logIPCResponse('receive', response);

        // If the response indicates an error, throw it
        if (!response.success) {
          throw new Error(response.error || `Unknown error in IPC channel ${channel}`);
        }
      }),
      map(response => response.data as R),
      catchError(error => {
        console.error(`Error in IPC communication on channel ${channel}:`, error);
        return throwError(() => new Error(`IPC Error (${channel}): ${error.message}`));
      })
    );
  }

  /**
   * Invoke the appropriate method on the ElectronWindowService based on the channel
   *
   * @param channel The channel/method to invoke
   * @param data The data to pass to the method
   * @returns A promise that resolves to the response
   */
  private invokeElectronMethod(channel: string, data: any): Promise<IPCResponse> {
    try {
      switch (channel) {
        case 'minimize-window':
          this.electronService.minimizeWindow();
          return Promise.resolve(createIPCResponse(true, { minimized: true }));

        case 'maximize-window':
          this.electronService.maximizeWindow();
          return Promise.resolve(createIPCResponse(true, { maximized: true }));

        case 'close-window':
          this.electronService.closeWindow();
          return Promise.resolve(createIPCResponse(true, { closed: true }));

        case 'is-window-maximized':
          return this.electronService.isMaximized()
            .then(maximized => createIPCResponse(true, { maximized }))
            .catch(error => createIPCResponse(false, undefined, error.message, 'MAXIMIZE_CHECK_ERROR'));

        case 'show-open-dialog':
          return this.electronService.showOpenDialog(data)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'DIALOG_ERROR'));

        case 'index-folder':
          return this.electronService.indexFolder(data, data.options)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'INDEX_FOLDER_ERROR'));

        case 'index-all-folders':
          return this.electronService.indexAllFolders(data, data.options)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'INDEX_ALL_FOLDERS_ERROR'));

        case 'start-watching-folders':
          return this.electronService.startWatchingFolders(data)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'START_WATCHING_ERROR'));

        case 'stop-watching-folders':
          return this.electronService.stopWatchingFolders()
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'STOP_WATCHING_ERROR'));

        case 'stop-folder-indexation':
          return this.electronService.stopFolderIndexation(data)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'STOP_INDEXATION_ERROR'));

        case 'check-folder-indexable':
          return this.electronService.checkFolderIndexable(data)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'CHECK_INDEXABLE_ERROR'));

        case 'remove-file-from-index':
          return this.electronService.removeFileFromIndex(data.filePath, data.folderId)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'REMOVE_FILE_ERROR'));

        case 'remove-folder-from-index':
          return this.electronService.removeFolderFromIndex(data)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'REMOVE_FOLDER_ERROR'));

        case 'get-indexation-error-log':
          return this.electronService.getIndexationErrorLog(data)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'GET_ERROR_LOG_ERROR'));

        case 'clear-indexation-error-log':
          return this.electronService.clearIndexationErrorLog(data)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'CLEAR_ERROR_LOG_ERROR'));

        case 'get-indexed-files-for-folder':
          return this.electronService.getIndexedFilesForFolder(data)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'GET_INDEXED_FILES_ERROR'));

        case 'send-indexed-files-response':
          return this.electronService.sendIndexedFilesResponse(data)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'SEND_FILES_RESPONSE_ERROR'));

        case 'send-folder-id-response':
          return this.electronService.sendFolderIdResponse(data)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'SEND_FOLDER_ID_RESPONSE_ERROR'));

        case 'open-directory':
          return this.electronService.openDirectory(data)
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'OPEN_DIRECTORY_ERROR'));

        case 'get-database-path':
          return this.electronService.getDatabasePath()
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'GET_DB_PATH_ERROR'));

        case 'clear-all-indexed-files':
          return this.electronService.clearAllIndexedFiles()
            .then(result => createIPCResponse(true, result))
            .catch(error => createIPCResponse(false, undefined, error.message, 'CLEAR_INDEXED_FILES_ERROR'));

        default:
          return Promise.resolve(createIPCResponse(false, undefined, `Unknown IPC channel: ${channel}`, 'UNKNOWN_CHANNEL'));
      }
    } catch (error) {
      console.error(`Error invoking Electron method for channel ${channel}:`, error);
      return Promise.resolve(createIPCResponse(
        false,
        undefined,
        `Error invoking Electron method: ${error.message}`,
        'INVOKE_METHOD_ERROR'
      ));
    }
  }

  // Public API methods that mirror the ElectronWindowService but use the enhanced IPC communication

  /**
   * Minimize the application window
   */
  minimizeWindow(): Observable<void> {
    return this.sendIPCMessage<void, void>('minimize-window', undefined).pipe(
      map(() => undefined)
    );
  }

  /**
   * Maximize or restore the application window
   */
  maximizeWindow(): Observable<void> {
    return this.sendIPCMessage<void, void>('maximize-window', undefined).pipe(
      map(() => undefined)
    );
  }

  /**
   * Close the application window
   */
  closeWindow(): Observable<void> {
    return this.sendIPCMessage<void, void>('close-window', undefined).pipe(
      map(() => undefined)
    );
  }

  /**
   * Check if the window is maximized
   */
  isMaximized(): Observable<boolean> {
    return this.sendIPCMessage<void, { maximized: boolean }>('is-window-maximized', undefined).pipe(
      map(result => result.maximized)
    );
  }

  /**
   * Show the open dialog
   *
   * @param options Dialog options
   */
  showOpenDialog(options: any): Observable<any> {
    return this.sendIPCMessage('show-open-dialog', options);
  }

  /**
   * Index a single folder
   *
   * @param folderPath Path to the folder to index
   * @param options Optional indexing options
   */
  indexFolder(folderPath: string, options?: { canBeCancelled?: boolean }): Observable<any> {
    return this.sendIPCMessage('index-folder', { folderPath, options });
  }

  /**
   * Index multiple folders
   *
   * @param folderPaths Array of folder paths to index
   * @param options Optional indexing options
   */
  indexAllFolders(folderPaths: string[], options?: { canBeCancelled?: boolean }): Observable<any> {
    return this.sendIPCMessage('index-all-folders', { folderPaths, options });
  }

  /**
   * Start watching folders for changes
   *
   * @param folderPaths Array of folder paths to watch
   */
  startWatchingFolders(folderPaths: string[]): Observable<any> {
    return this.sendIPCMessage('start-watching-folders', folderPaths);
  }

  /**
   * Stop watching all folders
   */
  stopWatchingFolders(): Observable<any> {
    return this.sendIPCMessage('stop-watching-folders', undefined);
  }

  /**
   * Stop indexation of a specific folder
   *
   * @param folderPath Path of the folder to stop indexing
   */
  stopFolderIndexation(folderPath: string): Observable<any> {
    return this.sendIPCMessage('stop-folder-indexation', folderPath);
  }

  /**
   * Check if a folder can be added for indexing
   *
   * @param folderPath Path of the folder to check
   */
  checkFolderIndexable(folderPath: string): Observable<any> {
    return this.sendIPCMessage('check-folder-indexable', folderPath);
  }

  /**
   * Remove a file from the index
   *
   * @param filePath Path to the file to remove from the index
   * @param folderId ID of the folder containing the file
   */
  removeFileFromIndex(filePath: string, folderId: string): Observable<any> {
    return this.sendIPCMessage('remove-file-from-index', { filePath, folderId });
  }

  /**
   * Remove a folder from the index
   *
   * @param folderPath Path of the folder to remove from the index
   */
  removeFolderFromIndex(folderPath: string): Observable<any> {
    return this.sendIPCMessage('remove-folder-from-index', folderPath);
  }

  /**
   * Get the indexation error log
   *
   * @param folderPath Optional folder path to filter errors by folder
   */
  getIndexationErrorLog(folderPath?: string): Observable<any> {
    return this.sendIPCMessage('get-indexation-error-log', folderPath);
  }

  /**
   * Clear the indexation error log
   *
   * @param folderPath Optional folder path to clear errors only for that folder
   */
  clearIndexationErrorLog(folderPath?: string): Observable<any> {
    return this.sendIPCMessage('clear-indexation-error-log', folderPath);
  }

  /**
   * Get indexed files for a specific folder
   *
   * @param folderPath Path of the folder to get indexed files for
   */
  getIndexedFilesForFolder(folderPath: string): Observable<any> {
    return this.sendIPCMessage('get-indexed-files-for-folder', folderPath);
  }

  /**
   * Send indexed files response back to main process
   *
   * @param response Response data
   */
  sendIndexedFilesResponse(response: any): Observable<any> {
    return this.sendIPCMessage('send-indexed-files-response', response);
  }

  /**
   * Send folder ID response back to main process
   *
   * @param response Response data
   */
  sendFolderIdResponse(response: any): Observable<any> {
    return this.sendIPCMessage('send-folder-id-response', response);
  }

  /**
   * Open a directory in the file explorer
   *
   * @param directoryPath Path of the directory to open
   */
  openDirectory(directoryPath: string): Observable<any> {
    return this.sendIPCMessage('open-directory', directoryPath);
  }

  /**
   * Get the database path
   */
  getDatabasePath(): Observable<any> {
    return this.sendIPCMessage('get-database-path', undefined);
  }

  /**
   * Clear all indexed files from the database
   */
  clearAllIndexedFiles(): Observable<any> {
    return this.sendIPCMessage('clear-all-indexed-files', undefined);
  }
}
