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
      indexFolder: (folderPath: string, options?: { canBeCancelled?: boolean }) => Promise<any>;
      cancelFolderIndexation: (folderPath: string) => Promise<any>;
      indexAllFolders: (folderPaths: string[], options?: { canBeCancelled?: boolean }) => Promise<any>;
      startWatchingFolders: (folderPaths: string[]) => Promise<any>;
      stopWatchingFolders: () => Promise<any>;
      stopFolderIndexation: (folderPath: string) => Promise<any>;
      checkFolderIndexable: (folderPath: string) => Promise<any>;
      removeFileFromIndex: (filePath: string, folderId: string) => Promise<any>;
      removeFolderFromIndex: (folderPath: string) => Promise<any>;
      // Indexation error log methods
      getIndexationErrorLog: (folderPath?: string) => Promise<any>;
      clearIndexationErrorLog: (folderPath?: string) => Promise<any>;
      // Get indexed files
      getIndexedFilesForFolder: (folderPath: string) => Promise<any>;
      sendIndexedFilesResponse: (response: any) => Promise<any>;
      // Folder ID operations for SQLite database
      sendFolderIdResponse: (response: any) => Promise<any>;
      // Directory operations
      openDirectory: (directoryPath: string) => Promise<any>;
      // Database operations
      getDatabasePath: () => Promise<any>;
      clearAllIndexedFiles: () => Promise<any>;
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
   * @param options Optional indexing options, including cancellation support
   */
  async indexFolder(folderPath: string, options?: { canBeCancelled?: boolean }): Promise<any> {
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
   * @param folderPaths Array of folder paths to index
   * @param options Optional indexing options, including cancellation support
   */
  async indexAllFolders(folderPaths: string[], options?: { canBeCancelled?: boolean }): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.indexAllFolders(folderPaths, options);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Start watching folders for changes
   * @param folderPaths Array of folder paths to watch
   */
  async startWatchingFolders(folderPaths: string[]): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.startWatchingFolders(folderPaths);
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
}
