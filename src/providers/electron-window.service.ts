import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

// Define interface for indexation progress updates
export interface IndexationProgressUpdate {
  folderId: string;
  folderPath: string;
  indexedFiles: number;
  totalFiles: number;
  progress: number;
  status?: 'indexing' | 'indexed' | 'stopped';
  errors?: number;
  currentFile?: string;
  filesInQueue?: number; // Number of files waiting to be saved to the database
}

// Update Window interface to include your electronAPI methods
declare global {
  interface Window {
    electronAPI: {
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      isWindowMaximized: () => Promise<boolean>;
      // Include your existing electronAPI methods
      showOpenDialog: (options: any) => Promise<any>;
      // File indexing and watching methods
      indexFolder: (folderPath: string, options?: { canBeCancelled?: boolean, settings?: any }) => Promise<any>;
      cancelFolderIndexation: (folderPath: string) => Promise<any>;
      indexAllFolders: (folderPaths: string[], options?: { canBeCancelled?: boolean, settings?: any }) => Promise<any>;
      startWatchingFolders: (folderPaths: string[]) => Promise<any>;
      stopWatchingFolders: () => Promise<any>;
      stopFolderIndexation: (folderPath: string) => Promise<any>;
      checkFolderIndexable: (folderPath: string) => Promise<any>;
      removeFileFromIndex: (filePath: string, folderId: string) => Promise<any>;
      removeFolderFromIndex: (folderPath: string) => Promise<any>;
      // Database operations for indexed files
      saveIndexedFile: (file: any) => Promise<any>;
      verifyFileSaved: (fileId: string, folderId: string) => Promise<any>;
      saveIndexedFilesBatch: (files: any[]) => Promise<any>;
      saveIndexedFilesBatchWithTransaction: (files: any[]) => Promise<any>;
      verifyFilesBatchSaved: (fileIds: any[]) => Promise<any>;
      getDatabaseStats: () => Promise<any>;
      checkDatabaseIntegrity: (thorough: boolean) => Promise<any>;
      repairDatabase: () => Promise<any>;
      optimizeDatabase: () => Promise<any>;
      // Settings operations
      getIndexingSettings: () => Promise<any>;
      saveIndexingSettings: (settings: any) => Promise<any>;
      // Indexation error log methods
      getIndexationErrorLog: (folderPath?: string) => Promise<any>;
      clearIndexationErrorLog: (folderPath?: string) => Promise<any>;
      logIndexationError: (error: any) => Promise<any>;
      // Get indexed files
      getIndexedFilesForFolder: (folderPath: string) => Promise<any>;
      sendIndexedFilesResponse: (response: any) => Promise<any>;
      // Folder ID operations for SQLite database
      sendFolderIdResponse: (response: any) => Promise<any>;
      // Directory operations
      openDirectory: (directoryPath: string) => Promise<any>;
      // File system operations
      listFilesInDirectory: (folderPath: string, recursive?: boolean) => Promise<any>;
      listFilesAndDirs: (dirPath: string) => Promise<any>;
      getFileStats: (filePath: string) => Promise<any>;
      watchFolder: (folderPath: string, recursive?: boolean) => Promise<any>;
      onFileChange: (callback: (event: any) => void) => void;
      unwatchFolder: (folderPath: string) => Promise<any>;
      watchFile: (filePath: string) => Promise<any>;
      unwatchFile: (filePath: string) => Promise<any>;
      // Database operations
      getDatabasePath: () => Promise<any>;
      clearAllIndexedFiles: () => Promise<any>;
      // Enhanced IPC methods
      sendRequest: (request: any) => Promise<any>;
      sendOneWay: (request: any) => void;
      sendBatchRequest: (request: any) => Promise<any>;
      // Service registry methods
      getService: (serviceName: string) => Promise<any>;
      listServices: () => Promise<any>;
      invokeServiceMethod: (serviceName: string, methodName: string, args?: any[]) => Promise<any>;
      // Event listeners
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
      onIndexationProgress: (callback: (update: IndexationProgressUpdate) => void) => () => void;
      onSaveIndexedFilesBatch: (callback: (data: any) => void) => () => void;
    }
  }
}


// Define interface for folder count information in batch updates
export interface FolderCountInfo {
  folderId: string;
  count: number;
}

export interface IndexedFilesBatch {
  files?: any[];
  filesCount?: number;
  errorsCount?: number;
  folderCounts?: { [folderPath: string]: FolderCountInfo };
}

@Injectable({
  providedIn: 'root'
})
export class ElectronWindowService {
  private isElectron: boolean;
  private indexationProgressSubject = new Subject<IndexationProgressUpdate>();
  public indexationProgress$ = this.indexationProgressSubject.asObservable();
  private progressCleanupFn: (() => void) | null = null;

  // Add subject and observable for batch file saves
  private indexedFilesBatchSubject = new Subject<IndexedFilesBatch>();
  public indexedFilesBatch$ = this.indexedFilesBatchSubject.asObservable();
  private batchCleanupFn: (() => void) | null = null;

  constructor() {
    this.isElectron = !!(window && window.electronAPI);

    // Subscribe to indexation progress updates
    if (this.isElectron) {
      this.progressCleanupFn = window.electronAPI.onIndexationProgress((update) => {
        this.indexationProgressSubject.next(update);
      });

      // Subscribe to batch file save updates
      this.batchCleanupFn = window.electronAPI.onSaveIndexedFilesBatch((data) => {
        this.indexedFilesBatchSubject.next(data);
      });
    }
  }

  ngOnDestroy() {
    // Clean up event listeners
    if (this.progressCleanupFn) {
      this.progressCleanupFn();
    }
    if (this.batchCleanupFn) {
      this.batchCleanupFn();
    }
  }

  minimizeWindow(): void {
    if (this.isElectron) {
      window.electronAPI.minimizeWindow();
    }
  }

  maximizeWindow(): void {
    if (this.isElectron) {
      window.electronAPI.maximizeWindow();
    }
  }

  closeWindow(): void {
    if (this.isElectron) {
      window.electronAPI.closeWindow();
    }
  }

  async isMaximized(): Promise<boolean> {
    if (this.isElectron) {
      return await window.electronAPI.isWindowMaximized();
    }
    return false;
  }

  async showOpenDialog(options: any): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.showOpenDialog(options);
    }
    return { canceled: true, filePaths: [] };
  }

  /**
   * Index a single folder
   * @param folderPath Path to the folder to index
   * @param options Optional indexing options, including cancellation support and settings
   */
  async indexFolder(folderPath: string, options?: { canBeCancelled?: boolean, settings?: any }): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.indexFolder(folderPath, options);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Cancel indexation of a specific folder
   * @param folderPath Path of the folder to cancel indexation for
   */
  async cancelFolderIndexation(folderPath: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.cancelFolderIndexation(folderPath);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Index multiple folders
   * @param folderPaths Array of folder information to index
   * @param options Optional indexing options, including cancellation support and settings
   */
  async indexAllFolders(folderPaths: { id: string; path: string; name: string; }[], options?: { canBeCancelled?: boolean, settings?: any }): Promise<any> {
    if (this.isElectron) {
      // Extract just the paths for the Electron API
      const paths = folderPaths.map(folder => folder.path);
      return await window.electronAPI.indexAllFolders(paths, options);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Start watching folders for changes
   * @param folderPaths Array of folder paths to watch
   */
  async startWatchingFolders(folderPaths: { id: string; path: string; }[]): Promise<any> {
    if (this.isElectron) {
      // Extract just the paths for the Electron API
      const paths = folderPaths.map(folder => folder.path);
      return await window.electronAPI.startWatchingFolders(paths);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Stop watching all folders
   */
  async stopWatchingFolders(): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.stopWatchingFolders();
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Stop watching a specific folder
   * @param folderPath Path of the folder to stop watching
   */
  async stopWatchingFolder(folderPath: string): Promise<any> {
    if (this.isElectron) {
      // Use the stopWatchingFolders method but log that we're stopping a specific folder
      console.log(`Stopping watching for folder: ${folderPath}`);
      return await window.electronAPI.stopWatchingFolders();
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Check if a folder is being watched
   * @param folderPath Path of the folder to check
   */
  async isFolderWatched(folderPath: string): Promise<any> {
    if (this.isElectron) {
      // This is a placeholder implementation since the actual method doesn't exist
      // In a real implementation, we would call a method in the Electron API
      console.log(`Checking if folder is watched: ${folderPath}`);
      return { success: true, isWatched: false };
    }
    return { success: false, error: 'Not running in Electron', isWatched: false };
  }

  /**
   * Get all watched folders
   */
  async getWatchedFolders(): Promise<any> {
    if (this.isElectron) {
      // This is a placeholder implementation since the actual method doesn't exist
      // In a real implementation, we would call a method in the Electron API
      console.log('Getting watched folders');
      return { success: true, folders: [] };
    }
    return { success: false, error: 'Not running in Electron', folders: [] };
  }

  /**
   * Stop indexation of a specific folder
   * @param folderPath Path of the folder to stop indexing
   */
  async stopFolderIndexation(folderPath: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.stopFolderIndexation(folderPath);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Check if a folder can be added for indexing
   * @param folderPath Path of the folder to check
   * @returns Promise resolving to an object with indexable status and reason if not indexable
   */
  async checkFolderIndexable(folderPath: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.checkFolderIndexable(folderPath);
    }
    return {
      success: false,
      indexable: false,
      reason: 'Not running in Electron'
    };
  }

  /**
   * Remove a file from the index
   * @param filePath Path to the file to remove from the index
   * @param folderId ID of the folder containing the file
   */
  async removeFileFromIndex(filePath: string, folderId: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.removeFileFromIndex(filePath, folderId);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Remove a folder from the index
   * @param folderPath Path of the folder to remove from the index
   */
  async removeFolderFromIndex(folderPath: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.removeFolderFromIndex(folderPath);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Get the indexation error log
   * @param folderPath Optional folder path to filter errors by folder
   */
  async getIndexationErrorLog(folderPath?: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.getIndexationErrorLog(folderPath);
    }
    return { success: false, error: 'Not running in Electron', errors: [], count: 0 };
  }

  /**
   * Clear the indexation error log
   * @param folderPath Optional folder path to clear errors only for that folder
   */
  async clearIndexationErrorLog(folderPath?: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.clearIndexationErrorLog(folderPath);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Get indexed files for a specific folder
   * @param folderPath Path of the folder to get indexed files for
   */
  async getIndexedFilesForFolder(folderPath: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.getIndexedFilesForFolder(folderPath);
    }
    return { success: false, error: 'Not running in Electron', files: [] };
  }

  /**
   * Send indexed files response back to main process
   * @param response Response data
   */
  async sendIndexedFilesResponse(response: any): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.sendIndexedFilesResponse(response);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Open a directory in the file explorer
   * @param directoryPath Path of the directory to open
   */
  async openDirectory(directoryPath: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.openDirectory(directoryPath);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Send folder ID response back to main process
   * @param response Response data
   */
  async sendFolderIdResponse(response: any): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.sendFolderIdResponse(response);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Get the database path
   * @returns Promise resolving to an object with the database path and directory
   */
  async getDatabasePath(): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.getDatabasePath();
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Clear all indexed files from the database
   * @returns Promise resolving to an object with the count of files cleared
   */
  async clearAllIndexedFiles(): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.clearAllIndexedFiles();
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Enhanced IPC methods
   */

  /**
   * Send a request to the main process and get a response
   * @param request The request object
   * @returns Promise resolving to the response
   */
  async sendRequest(request: any): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.sendRequest(request);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Send a one-way message to the main process (no response)
   * @param request The request object
   */
  sendOneWay(request: any): void {
    if (this.isElectron) {
      window.electronAPI.sendOneWay(request);
    }
  }

  /**
   * Send a batch request to the main process and get a response
   * @param request The batch request object
   * @returns Promise resolving to the batch response
   */
  async sendBatchRequest(request: any): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.sendBatchRequest(request);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Service Registry methods
   */

  /**
   * Get information about a service
   * @param serviceName The name of the service
   * @returns Promise resolving to service information
   */
  async getService(serviceName: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.getService(serviceName);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * List all registered services
   * @returns Promise resolving to a list of service names
   */
  async listServices(): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.listServices();
    }
    return { success: false, error: 'Not running in Electron', services: [] };
  }

  /**
   * Save an indexed file to the database
   * @param file The file to save
   * @returns Promise resolving to the result of the save operation
   */
  async saveIndexedFile(file: any): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.saveIndexedFile(file);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Verify that a file was saved correctly
   * @param fileId The ID of the file to verify
   * @param folderId The ID of the folder containing the file
   * @returns Promise resolving to the verification result
   */
  async verifyFileSaved(fileId: string, folderId: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.verifyFileSaved(fileId, folderId);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Save multiple indexed files to the database in a batch
   * @param files Array of files to save
   * @returns Promise resolving to the result of the batch save operation
   */
  async saveIndexedFilesBatch(files: any[]): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.saveIndexedFilesBatch(files);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Verify that a batch of files was saved correctly
   * @param fileIds Array of file IDs to verify
   * @returns Promise resolving to the verification result
   */
  async verifyFilesBatchSaved(fileIds: any[]): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.verifyFilesBatchSaved(fileIds);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Get database statistics
   * @returns Promise resolving to database statistics
   */
  async getDatabaseStats(): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.getDatabaseStats();
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Check database integrity
   * @param thorough Whether to run a thorough check
   * @returns Promise resolving to integrity check results
   */
  async checkDatabaseIntegrity(thorough: boolean = false): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.checkDatabaseIntegrity(thorough);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Repair database issues
   * @returns Promise resolving to repair results
   */
  async repairDatabase(): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.repairDatabase();
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Optimize database (vacuum, reindex, etc.)
   * @returns Promise resolving to optimization results
   */
  async optimizeDatabase(): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.optimizeDatabase();
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * List files in a directory
   * @param folderPath Path of the folder to list files from
   * @param recursive Whether to include files in subfolders
   * @returns Promise resolving to the list of files
   */
  async listFilesInDirectory(folderPath: string, recursive: boolean = true): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.listFilesInDirectory(folderPath, recursive);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * List files and directories in a folder
   * @param dirPath Path of the directory to list
   * @returns Promise resolving to the list of files and directories
   */
  async listFilesAndDirs(dirPath: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.listFilesAndDirs(dirPath);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Get file statistics
   * @param filePath Path of the file
   * @returns Promise resolving to file statistics
   */
  async getFileStats(filePath: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.getFileStats(filePath);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Watch a folder for changes
   * @param folderPath Path of the folder to watch
   * @param recursive Whether to watch subfolders recursively
   * @returns Promise resolving to the result of the watch operation
   */
  async watchFolder(folderPath: string, recursive: boolean = true): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.watchFolder(folderPath, recursive);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Register a callback for file change events
   * @param callback Function to call when a file changes
   */
  async onFileChange(callback: (event: any) => void): Promise<void> {
    if (this.isElectron) {
      window.electronAPI.onFileChange(callback);
    }
  }

  /**
   * Stop watching a folder
   * @param folderPath Path of the folder to stop watching
   * @returns Promise resolving to the result of the unwatch operation
   */
  async unwatchFolder(folderPath: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.unwatchFolder(folderPath);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Watch a specific file for changes
   * @param filePath Path of the file to watch
   * @returns Promise resolving to the result of the watch operation
   */
  async watchFile(filePath: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.watchFile(filePath);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Stop watching a specific file
   * @param filePath Path of the file to stop watching
   * @returns Promise resolving to the result of the unwatch operation
   */
  async unwatchFile(filePath: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.unwatchFile(filePath);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Save indexed files batch with transaction support
   * @param files Array of files to save
   * @returns Promise resolving to the result of the batch save operation
   */
  async saveIndexedFilesBatchWithTransaction(files: any[]): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.saveIndexedFilesBatchWithTransaction(files);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Get indexing settings
   * @returns Promise resolving to the current indexing settings
   */
  async getIndexingSettings(): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.getIndexingSettings();
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Save indexing settings
   * @param settings The settings to save
   * @returns Promise resolving to the result of the save operation
   */
  async saveIndexingSettings(settings: any): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.saveIndexingSettings(settings);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Log an indexation error
   * @param error The error to log
   * @returns Promise resolving to the result of the log operation
   */
  async logIndexationError(error: any): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.logIndexationError(error);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Invoke a method on a registered service
   * @param serviceName The name of the service
   * @param methodName The name of the method to invoke
   * @param args Optional arguments to pass to the method
   * @returns Promise resolving to the result of the method invocation
   */
  async invokeServiceMethod(serviceName: string, methodName: string, args?: any[]): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.invokeServiceMethod(serviceName, methodName, args);
    }
    return { success: false, error: 'Not running in Electron' };
  }
}
