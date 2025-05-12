import { Injectable } from '@angular/core';
import { Observable, from } from 'rxjs';
import { EnhancedIPCService } from './enhanced-ipc.service';
import { ElectronWindowService } from './electron-window.service';
import { IndexationProgressUpdate, IndexedFilesBatch } from './ipc-interfaces';

/**
 * IPC Compatibility Service
 *
 * This service provides a compatibility layer between the existing ElectronWindowService
 * and the new EnhancedIPCService. It allows for gradual migration to the new IPC system
 * without breaking existing code.
 *
 * It implements the same interface as ElectronWindowService but uses the enhanced IPC
 * communication under the hood when possible.
 */
@Injectable({
  providedIn: 'root'
})
export class IPCCompatibilityService {
  // Forward the observables from ElectronWindowService
  public indexationProgress$ = this.electronWindowService.indexationProgress$;
  public indexedFilesBatch$ = this.electronWindowService.indexedFilesBatch$;

  constructor(
    private enhancedIPC: EnhancedIPCService,
    private electronWindowService: ElectronWindowService
  ) {}

  /**
   * Minimize the window
   */
  minimizeWindow(): void {
    // Use the enhanced IPC service for one-way communication
    this.enhancedIPC.send('minimize-window', {});
  }

  /**
   * Maximize or restore the window
   */
  maximizeWindow(): void {
    this.enhancedIPC.send('maximize-window', {});
  }

  /**
   * Close the window
   */
  closeWindow(): void {
    this.enhancedIPC.send('close-window', {});
  }

  /**
   * Check if the window is maximized
   * @returns Promise resolving to a boolean indicating if the window is maximized
   */
  async isMaximized(): Promise<boolean> {
    const response = await this.enhancedIPC.invoke<{}, { maximized: boolean }>('is-window-maximized', {}).toPromise();
    return response.maximized;
  }

  /**
   * Show the open dialog
   * @param options Dialog options
   * @returns Promise resolving to the dialog result
   */
  async showOpenDialog(options: any): Promise<any> {
    return await this.enhancedIPC.invoke('show-open-dialog', options).toPromise();
  }

  /**
   * Index a folder
   * @param folderPath Path to the folder to index
   * @param options Optional indexing options
   * @returns Promise resolving to the indexing result
   */
  async indexFolder(folderPath: string, options?: { canBeCancelled?: boolean }): Promise<any> {
    // For now, use the existing implementation
    // This can be migrated to the enhanced IPC later
    return await this.electronWindowService.indexFolder(folderPath, options);
  }

  /**
   * Cancel indexation of a folder
   * @param folderPath Path to the folder to cancel indexation for
   * @returns Promise resolving to the cancellation result
   */
  async cancelFolderIndexation(folderPath: string): Promise<any> {
    return await this.electronWindowService.cancelFolderIndexation(folderPath);
  }

  /**
   * Index multiple folders
   * @param folderPaths Array of folder paths to index
   * @param options Optional indexing options
   * @returns Promise resolving to the indexing result
   */
  async indexAllFolders(folderPaths: string[], options?: { canBeCancelled?: boolean }): Promise<any> {
    // This is a good candidate for batch operations in the future
    return await this.electronWindowService.indexAllFolders(folderPaths, options);
  }

  /**
   * Start watching folders for changes
   * @param folderPaths Array of folder paths to watch
   * @returns Promise resolving to the watching result
   */
  async startWatchingFolders(folderPaths: string[]): Promise<any> {
    return await this.electronWindowService.startWatchingFolders(folderPaths);
  }

  /**
   * Stop watching all folders
   * @returns Promise resolving to the stop watching result
   */
  async stopWatchingFolders(): Promise<any> {
    return await this.electronWindowService.stopWatchingFolders();
  }

  /**
   * Stop indexation of a folder
   * @param folderPath Path to the folder to stop indexing
   * @returns Promise resolving to the stop indexation result
   */
  async stopFolderIndexation(folderPath: string): Promise<any> {
    return await this.electronWindowService.stopFolderIndexation(folderPath);
  }

  /**
   * Check if a folder can be indexed
   * @param folderPath Path to the folder to check
   * @returns Promise resolving to the check result
   */
  async checkFolderIndexable(folderPath: string): Promise<any> {
    return await this.electronWindowService.checkFolderIndexable(folderPath);
  }

  /**
   * Remove a file from the index
   * @param filePath Path to the file to remove
   * @param folderId ID of the folder containing the file
   * @returns Promise resolving to the removal result
   */
  async removeFileFromIndex(filePath: string, folderId: string): Promise<any> {
    return await this.electronWindowService.removeFileFromIndex(filePath, folderId);
  }

  /**
   * Remove a folder from the index
   * @param folderPath Path to the folder to remove
   * @returns Promise resolving to the removal result
   */
  async removeFolderFromIndex(folderPath: string): Promise<any> {
    return await this.electronWindowService.removeFolderFromIndex(folderPath);
  }

  /**
   * Get the indexation error log
   * @param folderPath Optional folder path to filter errors
   * @returns Promise resolving to the error log
   */
  async getIndexationErrorLog(folderPath?: string): Promise<any> {
    return await this.electronWindowService.getIndexationErrorLog(folderPath);
  }

  /**
   * Clear the indexation error log
   * @param folderPath Optional folder path to clear errors only for that folder
   * @returns Promise resolving to the clear result
   */
  async clearIndexationErrorLog(folderPath?: string): Promise<any> {
    return await this.electronWindowService.clearIndexationErrorLog(folderPath);
  }

  /**
   * Get indexed files for a folder
   * @param folderPath Path to the folder to get indexed files for
   * @returns Promise resolving to the indexed files
   */
  async getIndexedFilesForFolder(folderPath: string): Promise<any> {
    return await this.electronWindowService.getIndexedFilesForFolder(folderPath);
  }

  /**
   * Send indexed files response back to main process
   * @param response Response data
   * @returns Promise resolving to the send result
   */
  async sendIndexedFilesResponse(response: any): Promise<any> {
    return await this.electronWindowService.sendIndexedFilesResponse(response);
  }

  /**
   * Open a directory in the file explorer
   * @param directoryPath Path to the directory to open
   * @returns Promise resolving to the open result
   */
  async openDirectory(directoryPath: string): Promise<any> {
    return await this.electronWindowService.openDirectory(directoryPath);
  }

  /**
   * Send folder ID response back to main process
   * @param response Response data
   * @returns Promise resolving to the send result
   */
  async sendFolderIdResponse(response: any): Promise<any> {
    return await this.electronWindowService.sendFolderIdResponse(response);
  }

  /**
   * Get the database path
   * @returns Promise resolving to the database path
   */
  async getDatabasePath(): Promise<any> {
    return await this.electronWindowService.getDatabasePath();
  }

  /**
   * Clear all indexed files from the database
   * @returns Promise resolving to the clear result
   */
  async clearAllIndexedFiles(): Promise<any> {
    return await this.electronWindowService.clearAllIndexedFiles();
  }
}
