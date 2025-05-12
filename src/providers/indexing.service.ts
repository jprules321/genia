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

    // Subscribe to batch file save updates (now just for progress tracking)
    this.subscriptions.push(
      this.electronWindowService.indexedFilesBatch$.subscribe(data => {
        // Log the batch save notification
        console.log(`Batch of ${data.filesCount} files saved to database (${data.errorsCount} errors)`);

        // If we have folder-specific counts, update the folder stats
        if (data.folderCounts) {
          Object.entries(data.folderCounts).forEach(([folderPath, info]) => {
            const folderId = info.folderId;
            const count = info.count;

            // Only update stats if we have a valid folder ID and the folder is still being indexed
            if (folderId) {
              // Get current stats for this folder
              const stats = this.folderStats.get(folderId);
              if (stats) {
                // Only update if the folder is still being indexed
                if (stats.status === 'indexing') {
                  // Update indexed files count
                  const updatedStats = {
                    ...stats,
                    indexedFiles: stats.indexedFiles + count,
                    // Recalculate progress
                    progress: stats.totalFiles > 0
                      ? Math.min(100, Math.round((stats.indexedFiles + count) / stats.totalFiles * 100))
                      : 100
                  };

                  // Update the stats
                  this.folderStats.set(folderId, updatedStats);
                  this.saveFolderStats();
                }
              }
            }
          });
        }
      })
    );

    // Set up listeners for messages from main process
    if (window.electronAPI) {
      // Listener for get-indexed-files message
      const getIndexedFilesCleanup = window.electronAPI.on('get-indexed-files', (data: any) => {
        this.handleGetIndexedFilesRequest(data);
      });

      // Listener for get-folder-id message
      const getFolderIdCleanup = window.electronAPI.on('get-folder-id', (data: any) => {
        this.handleGetFolderIdRequest(data);
      });

      // Listener for remove-indexed-file message (just for UI updates)
      const removeIndexedFileCleanup = window.electronAPI.on('remove-indexed-file', (data: any) => {
        // Just log the removal notification, no need to remove from localStorage
        if (data.success) {
          console.log(`File removed from database: ${data.filePath}`);
        } else {
          console.error(`Error removing file from database: ${data.filePath}`, data.error);
        }
      });

      // Store cleanup functions to be called on destroy
      this.subscriptions.push(
        new Subscription(() => {
          getIndexedFilesCleanup();
          getFolderIdCleanup();
          removeIndexedFileCleanup();
        })
      );
    }
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
   * Get all indexed files - now returns an empty array since files are stored in SQLite
   * This method is kept for backward compatibility but should not be used
   */
  getIndexedFiles(): Observable<IndexedFile[]> {
    console.warn('getIndexedFiles() is deprecated - files are now stored in SQLite database');
    return of([]);
  }

  /**
   * Get indexed files for a specific folder - now returns an empty array since files are stored in SQLite
   * This method is kept for backward compatibility but should not be used
   */
  getIndexedFilesForFolder(folderId: string): Observable<IndexedFile[]> {
    console.warn('getIndexedFilesForFolder() is deprecated - files are now stored in SQLite database');
    return of([]);
  }

  /**
   * Handle request from main process to get folder ID for a folder path
   * @param data Request data containing folderPath
   */
  private handleGetFolderIdRequest(data: { folderPath: string }): void {
    console.log(`Received request for folder ID for path: ${data.folderPath}`);

    // Find the folder ID for the given folder path
    this.foldersService.getFolders().subscribe(
      folders => {
        const folder = folders.find(f => f.path === data.folderPath);

        if (!folder) {
          console.error(`Folder not found for path: ${data.folderPath}`);
          // Send error response back to main process
          this.sendFolderIdResponse({
            success: false,
            error: 'Folder not found',
            folderPath: data.folderPath
          });
          return;
        }

        // Send folder ID back to main process
        this.sendFolderIdResponse({
          success: true,
          folderId: folder.id,
          folderPath: data.folderPath
        });
      },
      error => {
        console.error('Error getting folders:', error);
        // Send error response back to main process
        this.sendFolderIdResponse({
          success: false,
          error: error.toString(),
          folderPath: data.folderPath
        });
      }
    );
  }

  /**
   * Send folder ID response back to main process
   * @param response Response data
   */
  private sendFolderIdResponse(response: any): void {
    // Use the ElectronWindowService to send the response back to the main process
    this.electronWindowService.sendFolderIdResponse(response).catch(error => {
      console.error('Error sending folder ID response:', error);
    });
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

  // Debounce mechanism to prevent multiple calls to startWatchingFolders
  private lastWatchingStarted: number = 0;
  private watchingDebounceTime: number = 1000; // 1 second debounce

  /**
   * Start watching all folders for changes
   */
  startWatchingFolders(): Observable<boolean> {
    // Check if we've recently started watching folders
    const now = Date.now();
    if (now - this.lastWatchingStarted < this.watchingDebounceTime) {
      console.log('Debouncing startWatchingFolders call - already called recently');
      return of(true); // Return success without actually calling again
    }

    // Update the last time we started watching
    this.lastWatchingStarted = now;

    return this.foldersService.getFolders().pipe(
      switchMap(folders => {
        if (folders.length === 0) {
          return of(true);
        }

        console.log(`Starting to watch ${folders.length} folders (debounced)`);
        // This would call the Electron main process to start watching folders
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

    // Call the Electron main process to remove the folder from the watchers and database
    return from(this.electronWindowService.removeFolderFromIndex(folder.path)).pipe(
      map(result => {
        if (result.success) {
          console.log(`Successfully removed folder from index: ${folder.name}`);
          console.log(`Removed ${result.filesRemoved} files from database for folder: ${folder.name}`);
          return true;
        } else {
          console.error(`Error removing folder from index: ${folder.name}`, result.error);
          return false;
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
   * Save an indexed file to storage - deprecated, files are now stored in SQLite
   * This method is kept for backward compatibility but should not be used
   */
  private saveIndexedFile(file: IndexedFile): Observable<IndexedFile> {
    console.warn('saveIndexedFile() is deprecated - files are now stored in SQLite database');
    return of(file);
  }

  /**
   * Save multiple indexed files to storage - deprecated, files are now stored in SQLite
   * This method is kept for backward compatibility but should not be used
   * @param files Array of files to save
   * @returns Observable of the number of files saved
   */
  private saveIndexedFilesBatch(files: IndexedFile[]): Observable<number> {
    console.warn('saveIndexedFilesBatch() is deprecated - files are now stored in SQLite database');
    return of(files ? files.length : 0);
  }

  /**
   * Remove a file from the index - deprecated, files are now stored in SQLite
   * This method is kept for backward compatibility but should not be used
   * @param filePath Path of the file to remove
   * @param folderId ID of the folder containing the file
   */
  removeFileFromIndex(filePath: string, folderId: string): Observable<boolean> {
    console.warn('removeFileFromIndex() is deprecated - files are now stored in SQLite database');
    return of(true);
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

  /**
   * Handle request from main process to get indexed files for a folder
   * @param data Request data containing folderPath
   */
  private handleGetIndexedFilesRequest(data: { folderPath: string }): void {
    console.log(`Received request for indexed files for folder: ${data.folderPath}`);

    // Find the folder ID for the given folder path
    this.foldersService.getFolders().subscribe(
      folders => {
        const folder = folders.find(f => f.path === data.folderPath);

        if (!folder) {
          console.error(`Folder not found for path: ${data.folderPath}`);
          // Send empty response back to main process
          this.sendIndexedFilesResponse({
            success: false,
            error: 'Folder not found',
            files: [],
            folderPath: data.folderPath
          });
          return;
        }

        // Send response back to main process with folder ID
        // The main process will now query the SQLite database directly
        this.sendIndexedFilesResponse({
          success: true,
          folderId: folder.id,
          folderPath: data.folderPath
        });
      },
      error => {
        console.error('Error getting folders:', error);
        // Send error response back to main process
        this.sendIndexedFilesResponse({
          success: false,
          error: error.toString(),
          files: [],
          folderPath: data.folderPath
        });
      }
    );
  }

  /**
   * Send indexed files response back to main process
   * @param response Response data
   */
  private sendIndexedFilesResponse(response: any): void {
    // Use the ElectronWindowService to send the response back to the main process
    this.electronWindowService.sendIndexedFilesResponse(response).catch(error => {
      console.error('Error sending indexed files response:', error);
    });
  }

  /**
   * Check if there are any folders and clear indexed files if none exist
   * This should be called on startup to ensure the database is clean
   * @returns Observable of boolean indicating if files were cleared
   */
  clearIndexedFilesIfNoFolders(): Observable<boolean> {
    return this.foldersService.getFolders().pipe(
      switchMap(folders => {
        if (folders.length === 0) {
          console.log('No folders found, clearing all indexed files');
          return from(this.electronWindowService.clearAllIndexedFiles()).pipe(
            map(result => {
              if (result.success) {
                console.log(`Cleared ${result.count} indexed files from database`);
                return true;
              } else {
                console.error('Error clearing indexed files:', result.error);
                return false;
              }
            }),
            catchError(error => {
              console.error('Error clearing indexed files:', error);
              return of(false);
            })
          );
        } else {
          console.log(`Found ${folders.length} folders, no need to clear indexed files`);
          return of(false);
        }
      })
    );
  }
}
