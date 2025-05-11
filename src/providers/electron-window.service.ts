import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

// Define interface for indexation progress updates
export interface IndexationProgressUpdate {
  folderId: string;
  folderPath: string;
  indexedFiles: number;
  totalFiles: number;
  progress: number;
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
      indexFolder: (folderPath: string) => Promise<any>;
      indexAllFolders: (folderPaths: string[]) => Promise<any>;
      startWatchingFolders: (folderPaths: string[]) => Promise<any>;
      stopWatchingFolders: () => Promise<any>;
      stopFolderIndexation: (folderPath: string) => Promise<any>;
      checkFolderIndexable: (folderPath: string) => Promise<any>;
      removeFileFromIndex: (filePath: string, folderId: string) => Promise<any>;
      removeFolderFromIndex: (folderPath: string) => Promise<any>;
      // Indexation error log methods
      getIndexationErrorLog: (folderPath?: string) => Promise<any>;
      clearIndexationErrorLog: (folderPath?: string) => Promise<any>;
      // Event listeners
      on: (channel: string, callback: (...args: any[]) => void) => () => void;
      onIndexationProgress: (callback: (update: IndexationProgressUpdate) => void) => () => void;
    }
  }
}

@Injectable({
  providedIn: 'root'
})
export class ElectronWindowService {
  private isElectron: boolean;
  private indexationProgressSubject = new Subject<IndexationProgressUpdate>();
  public indexationProgress$ = this.indexationProgressSubject.asObservable();
  private progressCleanupFn: (() => void) | null = null;

  constructor() {
    this.isElectron = !!(window && window.electronAPI);

    // Subscribe to indexation progress updates
    if (this.isElectron) {
      this.progressCleanupFn = window.electronAPI.onIndexationProgress((update) => {
        this.indexationProgressSubject.next(update);
      });
    }
  }

  ngOnDestroy() {
    // Clean up event listeners
    if (this.progressCleanupFn) {
      this.progressCleanupFn();
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
   */
  async indexFolder(folderPath: string): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.indexFolder(folderPath);
    }
    return { success: false, error: 'Not running in Electron' };
  }

  /**
   * Index multiple folders
   * @param folderPaths Array of folder paths to index
   */
  async indexAllFolders(folderPaths: string[]): Promise<any> {
    if (this.isElectron) {
      return await window.electronAPI.indexAllFolders(folderPaths);
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
}
