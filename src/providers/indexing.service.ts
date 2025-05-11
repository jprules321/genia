import { Injectable, OnDestroy } from '@angular/core';
import { Observable, from, of, Subscription } from 'rxjs';
import { map, catchError, tap, switchMap } from 'rxjs/operators';
import { FoldersService } from './folders.service';
import { ElectronWindowService, IndexationProgressUpdate } from './electron-window.service';
import { Folder } from '../components/folders/folders.component';

// Define interfaces for our indexing system
export interface IndexedFile {
  id: string;
  folderId: string;
  path: string;
  filename: string;
  content: string;
  embedding?: any; // This would be the vector embedding
  lastIndexed: Date;
  lastModified: Date;
}

export interface IndexingStatus {
  inProgress: boolean;
  currentFolder?: string;
  currentFile?: string;
  progress: number; // 0-100
  error?: string;
}

export interface IndexationError {
  timestamp: Date;
  folderPath: string;
  filePath: string;
  error: string;
}

@Injectable({
  providedIn: 'root'
})
export class IndexingService implements OnDestroy {
  private readonly STORAGE_KEY = 'genia_indexed_files';
  private readonly STATUS_KEY = 'genia_indexing_status';
  private readonly FOLDER_STATS_KEY = 'genia_folder_stats';
  private status: IndexingStatus = {
    inProgress: false,
    progress: 0
  };
  private folderStats: Map<string, {
    indexedFiles: number,
    totalFiles: number,
    progress?: number,
    status?: 'indexing' | 'indexed' | 'stopped'
  }> = new Map();
  private subscriptions: Subscription[] = [];

  constructor(
    private foldersService: FoldersService,
    private electronWindowService: ElectronWindowService
  ) {
    // Initialize status from localStorage if available
    const savedStatus = localStorage.getItem(this.STATUS_KEY);
    if (savedStatus) {
      this.status = JSON.parse(savedStatus);
      // Reset inProgress to false on startup
      this.status.inProgress = false;
      this.saveStatus();
    }

    // Initialize folder stats from localStorage if available
    const savedFolderStats = localStorage.getItem(this.FOLDER_STATS_KEY);
    if (savedFolderStats) {
      try {
        // Convert the JSON object back to a Map
        const statsObj = JSON.parse(savedFolderStats);
        this.folderStats = new Map(Object.entries(statsObj));
      } catch (error) {
        console.error('Error parsing folder stats:', error);
        this.folderStats = new Map();
      }
    }

    // Subscribe to indexation progress updates
    this.subscriptions.push(
      this.electronWindowService.indexationProgress$.subscribe(update => {
        this.handleIndexationProgressUpdate(update);
      })
    );
  }

  ngOnDestroy() {
    // Clean up subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  /**
   * Handle indexation progress updates from the main process
   * @param update The progress update
   */
  private handleIndexationProgressUpdate(update: IndexationProgressUpdate) {
    // console.log('Received indexation progress update:', update);

    // Determine status based on progress and status field
    let inProgress = update.progress < 100;
    let progress = update.progress;

    // Handle stopped status (progress = -1)
    if (update.status === 'stopped') {
      inProgress = false;
      // Keep the progress value as -1 to indicate stopped
    }

    // Update the global status
    this.status = {
      inProgress: inProgress,
      currentFolder: update.folderPath,
      currentFile: undefined, // We don't have this information
      progress: progress
    };
    this.saveStatus();

    // Update the folder stats with progress and status
    this.updateFolderIndexingStats(update.folderId, {
      indexedFiles: update.indexedFiles,
      totalFiles: update.totalFiles,
      progress: progress,
      status: update.status
    });

    // If indexation is complete (progress = 100%), make sure we persist the final state
    if (update.progress === 100) {
      // Give it a short delay to ensure all updates are processed
      setTimeout(() => {
        // Ensure the status is saved with the correct progress
        if (this.status.progress === 100) {
          this.status = {
            inProgress: false,
            progress: 100
          };
        }
        this.saveStatus();
        this.saveFolderStats();
      }, 500);
    }
  }

  /**
   * Get all indexed files from local storage
   */
  getIndexedFiles(): Observable<IndexedFile[]> {
    try {
      const filesJson = localStorage.getItem(this.STORAGE_KEY);
      const files = filesJson ? JSON.parse(filesJson) : [];

      // Convert date strings to Date objects
      const filesWithDates = files.map(file => ({
        ...file,
        lastIndexed: file.lastIndexed ? new Date(file.lastIndexed) : new Date(),
        lastModified: file.lastModified ? new Date(file.lastModified) : new Date()
      }));

      return of(filesWithDates);
    } catch (error) {
      console.error('Error getting indexed files:', error);
      return of([]);
    }
  }

  /**
   * Get indexed files for a specific folder
   */
  getIndexedFilesForFolder(folderId: string): Observable<IndexedFile[]> {
    return this.getIndexedFiles().pipe(
      map(files => files.filter(file => file.folderId === folderId))
    );
  }

  /**
   * Start indexing a specific folder
   */
  indexFolder(folder: Folder): Observable<boolean> {
    // Update status
    this.status = {
      inProgress: true,
      currentFolder: folder.name,
      progress: 0
    };
    this.saveStatus();

    // Call the Electron main process to read and index files
    return from(this.invokeIndexFolder(folder)).pipe(
      tap(result => {
        console.log('Folder indexation completed:', result);

        // The progress updates are now handled by the handleIndexationProgressUpdate method
        // which is called when we receive progress updates from the main process

        // Ensure the folder stats are updated with the final values
        if (result.success) {
          this.updateFolderIndexingStats(folder.id, {
            indexedFiles: result.filesIndexed || 0,
            totalFiles: result.totalFiles || result.filesIndexed || 0
          });
        }
      }),
      catchError(error => {
        console.error('Error indexing folder:', error);
        this.status = {
          inProgress: false,
          progress: 0,
          error: error.toString()
        };
        this.saveStatus();
        throw error;
      })
    );
  }

  /**
   * Start indexing all folders
   */
  indexAllFolders(): Observable<boolean> {
    return this.foldersService.getFolders().pipe(
      switchMap(folders => {
        if (folders.length === 0) {
          return of(true);
        }

        // Update status
        this.status = {
          inProgress: true,
          currentFolder: 'All folders',
          progress: 0
        };
        this.saveStatus();

        // This would call the Electron main process to read and index files
        // For now, we'll simulate this with a placeholder
        return from(this.invokeIndexAllFolders(folders)).pipe(
          tap(success => {
            // Update status when done
            this.status = {
              inProgress: false,
              progress: 100
            };
            this.saveStatus();
          }),
          catchError(error => {
            console.error('Error indexing all folders:', error);
            this.status = {
              inProgress: false,
              progress: 0,
              error: error.toString()
            };
            this.saveStatus();
            throw error;
          })
        );
      })
    );
  }

  /**
   * Start watching all folders for changes
   */
  startWatchingFolders(): Observable<boolean> {
    return this.foldersService.getFolders().pipe(
      switchMap(folders => {
        if (folders.length === 0) {
          return of(true);
        }

        // This would call the Electron main process to start watching folders
        // For now, we'll simulate this with a placeholder
        return from(this.invokeStartWatching(folders)).pipe(
          catchError(error => {
            console.error('Error starting folder watching:', error);
            throw error;
          })
        );
      })
    );
  }

  /**
   * Stop watching all folders
   */
  stopWatchingFolders(): Observable<boolean> {
    // This would call the Electron main process to stop watching folders
    // For now, we'll simulate this with a placeholder
    return from(this.invokeStopWatching()).pipe(
      catchError(error => {
        console.error('Error stopping folder watching:', error);
        throw error;
      })
    );
  }

  /**
   * Stop indexation of a specific folder
   * @param folderPath Path of the folder to stop indexing
   */
  stopFolderIndexation(folderPath: string): Observable<boolean> {
    // Update status if this is the folder being indexed
    if (this.status.inProgress && this.status.currentFolder === folderPath) {
      this.status = {
        inProgress: false,
        progress: 0,
        error: 'Indexation stopped by user'
      };
      this.saveStatus();
    }

    // Call the Electron main process to stop indexation
    return from(this.electronWindowService.stopFolderIndexation(folderPath)).pipe(
      map(result => result.success),
      catchError(error => {
        console.error('Error stopping folder indexation:', error);
        return of(false);
      })
    );
  }

  /**
   * Get current indexing status
   */
  getIndexingStatus(): IndexingStatus {
    return this.status;
  }

  /**
   * Reset indexing status to not in progress
   */
  resetIndexingStatus(): void {
    this.status = {
      inProgress: false,
      progress: 0
    };
    this.saveStatus();
  }

  /**
   * Get indexing stats for a specific folder
   * @param folderId The ID of the folder
   * @returns Object with indexedFiles, totalFiles, progress, and status, or null if not available
   */
  getFolderIndexingStats(folderId: string): {
    indexedFiles: number,
    totalFiles: number,
    progress?: number,
    status?: 'indexing' | 'indexed' | 'stopped'
  } | null {
    return this.folderStats.get(folderId) || null;
  }

  /**
   * Get indexing stats for all folders
   * @returns Map of folder IDs to indexing stats
   */
  getAllFolderIndexingStats(): Map<string, {
    indexedFiles: number,
    totalFiles: number,
    progress?: number,
    status?: 'indexing' | 'indexed' | 'stopped'
  }> {
    return new Map(this.folderStats);
  }

  /**
   * Update indexing stats for a folder
   * @param folderId The ID of the folder
   * @param stats Object with indexedFiles, totalFiles, progress, and status
   */
  updateFolderIndexingStats(folderId: string, stats: {
    indexedFiles: number,
    totalFiles: number,
    progress?: number,
    status?: 'indexing' | 'indexed' | 'stopped'
  }): void {
    this.folderStats.set(folderId, stats);
    this.saveFolderStats();
  }

  /**
   * Remove indexing stats for a folder
   * @param folderId The ID of the folder to remove stats for
   */
  removeFolderIndexingStats(folderId: string): void {
    if (this.folderStats.has(folderId)) {
      this.folderStats.delete(folderId);
      this.saveFolderStats();
    }
  }

  /**
   * Remove a folder from the index
   * This removes all indexed files for the folder and stops watching the folder
   * @param folder The folder to remove from the index
   * @returns Observable that completes when the folder is removed from the index
   */
  removeFolderFromIndex(folder: Folder): Observable<boolean> {
    console.log(`Removing folder from index: ${folder.name} (${folder.path})`);

    // First remove all indexed files for this folder from localStorage
    return this.getIndexedFiles().pipe(
      switchMap(files => {
        // Filter out all files associated with this folder
        const updatedFiles = files.filter(file => file.folderId !== folder.id);

        // If we removed any files, save the updated array
        if (updatedFiles.length !== files.length) {
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updatedFiles));
          console.log(`Removed ${files.length - updatedFiles.length} files from index for folder: ${folder.name}`);
        }

        // Now call the Electron main process to remove the folder from the watchers
        return from(this.electronWindowService.removeFolderFromIndex(folder.path));
      }),
      switchMap(result => {
        if (result.success) {
          console.log(`Successfully removed folder from index: ${folder.name}`);
          return of(true);
        } else {
          console.error(`Error removing folder from index: ${folder.name}`, result.error);
          return of(false);
        }
      }),
      catchError(error => {
        console.error(`Error removing folder from index: ${folder.name}`, error);
        return of(false);
      })
    );
  }

  /**
   * Save folder stats to localStorage
   */
  private saveFolderStats(): void {
    // Convert Map to a plain object for JSON serialization
    const statsObj = Object.fromEntries(this.folderStats);
    localStorage.setItem(this.FOLDER_STATS_KEY, JSON.stringify(statsObj));
  }

  /**
   * Save an indexed file to storage
   */
  private saveIndexedFile(file: IndexedFile): Observable<IndexedFile> {
    return this.getIndexedFiles().pipe(
      map(files => {
        const index = files.findIndex(f => f.id === file.id);

        // Ensure dates are Date objects
        const fileWithDates = {
          ...file,
          lastIndexed: file.lastIndexed instanceof Date ? file.lastIndexed : new Date(file.lastIndexed),
          lastModified: file.lastModified instanceof Date ? file.lastModified : new Date(file.lastModified)
        };

        let updatedFiles: IndexedFile[];
        if (index === -1) {
          // New file
          updatedFiles = [...files, fileWithDates];
        } else {
          // Update existing file
          updatedFiles = [
            ...files.slice(0, index),
            fileWithDates,
            ...files.slice(index + 1)
          ];
        }

        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updatedFiles));
        return fileWithDates;
      })
    );
  }

  /**
   * Remove a file from the index
   * @param filePath Path of the file to remove
   * @param folderId ID of the folder containing the file
   */
  removeFileFromIndex(filePath: string, folderId: string): Observable<boolean> {
    return this.getIndexedFiles().pipe(
      map(files => {
        // Find the file by path and folder ID
        const index = files.findIndex(f => f.path === filePath && f.folderId === folderId);

        if (index === -1) {
          // File not found in index
          console.log(`File not found in index: ${filePath}`);
          return false;
        }

        // Remove the file from the array
        const updatedFiles = [
          ...files.slice(0, index),
          ...files.slice(index + 1)
        ];

        // Save the updated files array
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updatedFiles));
        console.log(`Removed file from index: ${filePath}`);

        return true;
      }),
      catchError(error => {
        console.error('Error removing file from index:', error);
        return of(false);
      })
    );
  }

  /**
   * Save current status to localStorage
   */
  private saveStatus(): void {
    localStorage.setItem(this.STATUS_KEY, JSON.stringify(this.status));
  }

  /**
   * Call Electron IPC to index a folder
   */
  private async invokeIndexFolder(folder: Folder): Promise<any> {
    try {
      console.log(`Indexing folder: ${folder.name} (${folder.path})`);
      const result = await this.electronWindowService.indexFolder(folder.path);

      if (result.success) {
        // The folder stats are now updated by the handleIndexationProgressUpdate method
        // which is called when we receive progress updates from the main process

        // Update the folder object with indexing progress
        folder.indexedFiles = result.filesIndexed || 0;
        folder.totalFiles = result.totalFiles || result.filesIndexed || 0;
        folder.indexingProgress = result.totalFiles > 0
          ? Math.round((result.filesIndexed / result.totalFiles) * 100)
          : 100;
      }

      return result;
    } catch (error) {
      console.error('Error in invokeIndexFolder:', error);
      return { success: false, error: error.toString() };
    }
  }

  /**
   * Call Electron IPC to index all folders
   */
  private async invokeIndexAllFolders(folders: Folder[]): Promise<boolean> {
    try {
      console.log(`Indexing ${folders.length} folders`);
      const folderPaths = folders.map(folder => folder.path);
      const result = await this.electronWindowService.indexAllFolders(folderPaths);
      return result.success;
    } catch (error) {
      console.error('Error in invokeIndexAllFolders:', error);
      return false;
    }
  }

  /**
   * Call Electron IPC to start watching folders
   */
  private async invokeStartWatching(folders: Folder[]): Promise<boolean> {
    try {
      console.log(`Starting to watch ${folders.length} folders`);
      const folderPaths = folders.map(folder => folder.path);
      const result = await this.electronWindowService.startWatchingFolders(folderPaths);
      return result.success;
    } catch (error) {
      console.error('Error in invokeStartWatching:', error);
      return false;
    }
  }

  /**
   * Call Electron IPC to stop watching folders
   */
  private async invokeStopWatching(): Promise<boolean> {
    try {
      console.log('Stopping folder watching');
      const result = await this.electronWindowService.stopWatchingFolders();
      return result.success;
    } catch (error) {
      console.error('Error in invokeStopWatching:', error);
      return false;
    }
  }

  /**
   * Call Electron IPC to remove a file from the index
   * @param filePath Path of the file to remove
   * @param folderId ID of the folder containing the file
   */
  private async invokeRemoveFileFromIndex(filePath: string, folderId: string): Promise<boolean> {
    try {
      console.log(`Removing file from index: ${filePath}`);
      const result = await this.electronWindowService.removeFileFromIndex(filePath, folderId);
      return result.success;
    } catch (error) {
      console.error('Error in invokeRemoveFileFromIndex:', error);
      return false;
    }
  }

  /**
   * Get indexation errors for a specific folder or all folders
   * @param folderPath Optional folder path to filter errors
   * @returns Observable of IndexationError array
   */
  getIndexationErrors(folderPath?: string): Observable<IndexationError[]> {
    return from(this.electronWindowService.getIndexationErrorLog(folderPath)).pipe(
      map(result => {
        if (result.success) {
          // Convert timestamp strings to Date objects
          return result.errors.map(error => ({
            ...error,
            timestamp: new Date(error.timestamp)
          }));
        }
        return [];
      }),
      catchError(error => {
        console.error('Error getting indexation errors:', error);
        return of([]);
      })
    );
  }

  /**
   * Check if a folder has indexation errors
   * @param folderId The folder ID to check
   * @returns Observable of boolean indicating if the folder has errors
   */
  hasFolderIndexationErrors(folderPath: string): Observable<boolean> {
    return this.getIndexationErrors(folderPath).pipe(
      map(errors => errors.length > 0)
    );
  }

  /**
   * Get the count of indexation errors for a folder
   * @param folderPath The folder path to check
   * @returns Observable of the error count
   */
  getFolderErrorCount(folderPath: string): Observable<number> {
    return this.getIndexationErrors(folderPath).pipe(
      map(errors => errors.length)
    );
  }

  /**
   * Clear indexation errors for a specific folder or all folders
   * @param folderPath Optional folder path to clear errors for
   * @returns Observable of boolean indicating success
   */
  clearIndexationErrors(folderPath?: string): Observable<boolean> {
    return from(this.electronWindowService.clearIndexationErrorLog(folderPath)).pipe(
      map(result => result.success),
      catchError(error => {
        console.error('Error clearing indexation errors:', error);
        return of(false);
      })
    );
  }
}
