import { Injectable, OnDestroy } from '@angular/core';
import { Observable, from, of, Subscription } from 'rxjs';
import { map, catchError, tap, switchMap } from 'rxjs/operators';
import { FoldersService } from './folders.service';
import { ElectronWindowService, IndexationProgressUpdate } from './electron-window.service';
import { Folder } from '../components/folders/folders.component';
import { FileIndexingService } from './file-indexing.service';
import { IndexDatabaseService } from './index-database.service';
import { IncrementalIndexingService } from './incremental-indexing.service';

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
  startTime?: Date;
  endTime?: Date;
  estimatedTimeRemaining?: number; // in milliseconds
  processingSpeed?: number; // files per second
  totalFiles?: number;
  processedFiles?: number;
  errorCount?: number;
  cancellationToken?: CancellationToken; // Token for cancelling the operation
  isCancelled?: boolean; // Whether the operation has been cancelled
}

export enum IndexationErrorType {
  NETWORK = 'network',
  FILE_SYSTEM = 'file_system',
  PERMISSION = 'permission',
  DATABASE = 'database',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled',
  UNKNOWN = 'unknown'
}

/**
 * Cancellation token for long-running operations
 */
export class CancellationToken {
  private _isCancelled = false;
  private _cancelCallbacks: (() => void)[] = [];

  /**
   * Check if the operation has been cancelled
   */
  get isCancelled(): boolean {
    return this._isCancelled;
  }

  /**
   * Cancel the operation
   */
  cancel(): void {
    if (!this._isCancelled) {
      this._isCancelled = true;
      // Execute all registered callbacks
      this._cancelCallbacks.forEach(callback => {
        try {
          callback();
        } catch (error) {
          console.error('Error in cancellation callback:', error);
        }
      });
    }
  }

  /**
   * Register a callback to be called when the operation is cancelled
   * @param callback The callback function
   * @returns A function to unregister the callback
   */
  onCancel(callback: () => void): () => void {
    this._cancelCallbacks.push(callback);
    return () => {
      const index = this._cancelCallbacks.indexOf(callback);
      if (index !== -1) {
        this._cancelCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Throw an error if the operation has been cancelled
   * @throws Error if the operation has been cancelled
   */
  throwIfCancelled(): void {
    if (this._isCancelled) {
      throw new Error('Operation was cancelled');
    }
  }
}

export interface IndexationError {
  timestamp: Date;
  folderPath: string;
  filePath: string;
  error: string;
  errorType: IndexationErrorType;
  details?: any;
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
    private electronWindowService: ElectronWindowService,
    private fileIndexingService: FileIndexingService,
    private indexDatabaseService: IndexDatabaseService,
    private incrementalIndexingService: IncrementalIndexingService
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

    // Calculate enhanced progress metrics
    const now = new Date();

    // If this is the first update or we're starting a new indexation, initialize startTime
    if (!this.status.startTime || !this.status.inProgress ||
        (inProgress && this.status.progress === 100)) {
      this.status.startTime = now;
      this.status.processedFiles = 0;
      this.status.errorCount = 0;
    }

    // Calculate processing speed and estimated time remaining
    let processingSpeed = 0;
    let estimatedTimeRemaining = 0;

    if (this.status.startTime && update.indexedFiles > 0) {
      // Time elapsed in seconds
      const elapsedTime = (now.getTime() - this.status.startTime.getTime()) / 1000;

      if (elapsedTime > 0) {
        // Files processed per second
        processingSpeed = update.indexedFiles / elapsedTime;

        // Estimate time remaining if we have total files and progress is not 100%
        if (update.totalFiles > 0 && progress < 100) {
          const remainingFiles = update.totalFiles - update.indexedFiles;
          estimatedTimeRemaining = (remainingFiles / processingSpeed) * 1000; // convert to ms
        }
      }
    }

    // Track error count if available
    const errorCount = update.errors || this.status.errorCount || 0;

    // Set end time if indexation is complete or stopped
    const endTime = (!inProgress) ? now : undefined;

    // Update the global status with enhanced metrics
    this.status = {
      inProgress: inProgress,
      currentFolder: update.folderPath,
      currentFile: update.currentFile, // May be undefined
      progress: progress,
      startTime: this.status.startTime,
      endTime: endTime,
      processingSpeed: processingSpeed,
      estimatedTimeRemaining: estimatedTimeRemaining,
      totalFiles: update.totalFiles,
      processedFiles: update.indexedFiles,
      errorCount: errorCount
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
            progress: 100,
            startTime: this.status.startTime,
            endTime: now,
            totalFiles: this.status.totalFiles,
            processedFiles: this.status.processedFiles,
            errorCount: this.status.errorCount
          };
        }
        this.saveStatus();
        this.saveFolderStats();

        // Log completion statistics
        if (this.status.startTime && this.status.endTime) {
          const totalTime = (this.status.endTime.getTime() - this.status.startTime.getTime()) / 1000;
          console.log(`Indexation completed in ${totalTime.toFixed(2)} seconds`);
          console.log(`Processed ${this.status.processedFiles} files (${this.status.errorCount} errors)`);
          console.log(`Average processing speed: ${(this.status.processedFiles / totalTime).toFixed(2)} files/second`);
        }
      }, 500);
    }
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
        console.log(`Found ${folders.length} folders in storage`);

        // First try to find an exact match
        const folder = folders.find(f => f.path === data.folderPath);

        if (!folder) {
          console.error(`Folder not found for path: ${data.folderPath}`);
          console.log(`Available folder paths: ${folders.map(f => f.path).join(', ')}`);

          // Send error response back to main process
          this.sendFolderIdResponse({
            success: false,
            error: 'Folder not found',
            folderPath: data.folderPath
          });
          return;
        }

        console.log(`Found folder with ID ${folder.id} for path ${data.folderPath}`);

        // Check if the folder is being deleted
        if (folder.deleting) {
          console.log(`Folder ${folder.name} (${folder.id}) is being deleted, but we can still use its ID`);
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
   * @param folder The folder to index
   * @param cancellationToken Optional cancellation token to cancel the operation
   * @deprecated This method should be refactored to use FileIndexingService and IncrementalIndexingService
   */
  indexFolder(folder: Folder, cancellationToken?: CancellationToken): Observable<boolean> {
    // Create a new cancellation token if one wasn't provided
    const token = cancellationToken || new CancellationToken();

    // Update status with cancellation token
    this.status = {
      inProgress: true,
      currentFolder: folder.name,
      progress: 0,
      cancellationToken: token,
      isCancelled: false
    };
    this.saveStatus();

    // Register a callback to update status when cancelled
    const unregisterCallback = token.onCancel(() => {
      console.log(`Indexation of folder ${folder.name} was cancelled`);
      this.status.isCancelled = true;
      this.status.error = 'Indexation cancelled by user';
      this.saveStatus();
    });

    // Call the Electron main process to read and index files
    return from(this.invokeIndexFolder(folder, token)).pipe(
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

        // Clean up the cancellation callback
        unregisterCallback();
      }),
      catchError(error => {
        console.error('Error indexing folder:', error);

        // Check if the error was due to cancellation
        const wasCancelled = token.isCancelled;

        this.status = {
          inProgress: false,
          progress: 0,
          error: wasCancelled ? 'Indexation cancelled by user' : error.toString(),
          isCancelled: wasCancelled
        };
        this.saveStatus();

        // Clean up the cancellation callback
        unregisterCallback();

        throw error;
      })
    );
  }

  /**
   * Start indexing all folders
   * @param cancellationToken Optional cancellation token to cancel the operation
   * @deprecated This method should be refactored to use FileIndexingService and IncrementalIndexingService
   */
  indexAllFolders(cancellationToken?: CancellationToken): Observable<boolean> {
    return this.foldersService.getFolders().pipe(
      switchMap(folders => {
        if (folders.length === 0) {
          return of(true);
        }

        // Create a new cancellation token if one wasn't provided
        const token = cancellationToken || new CancellationToken();

        // Update status with cancellation token
        this.status = {
          inProgress: true,
          currentFolder: 'All folders',
          progress: 0,
          cancellationToken: token,
          isCancelled: false
        };
        this.saveStatus();

        // Register a callback to update status when cancelled
        const unregisterCallback = token.onCancel(() => {
          console.log('Indexation of all folders was cancelled');
          this.status.isCancelled = true;
          this.status.error = 'Indexation cancelled by user';
          this.saveStatus();
        });

        // Call the Electron main process to read and index files
        return from(this.invokeIndexAllFolders(folders, token)).pipe(
          tap(result => {
            // Update status when done
            this.status = {
              inProgress: false,
              progress: 100
            };
            this.saveStatus();

            // Clean up the cancellation callback
            unregisterCallback();
          }),
          catchError(error => {
            console.error('Error indexing all folders:', error);

            // Check if the error was due to cancellation
            const wasCancelled = token.isCancelled;

            this.status = {
              inProgress: false,
              progress: 0,
              error: wasCancelled ? 'Indexation cancelled by user' : error.toString(),
              isCancelled: wasCancelled
            };
            this.saveStatus();

            // Clean up the cancellation callback
            unregisterCallback();

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
   * @deprecated Use IndexDatabaseService.removeFolderFromIndex instead
   */
  removeFolderFromIndex(folder: Folder): Observable<boolean> {
    // Check if folder is valid and has a path
    if (!folder || !folder.path) {
      console.error('Invalid folder object or missing path:', folder);
      return of(false);
    }

    const folderName = folder.name || 'Unknown folder';
    const folderPath = folder.path;
    const folderId = folder.id || '';

    console.log(`Removing folder from index: ${folderName} (${folderPath})`);

    // Delegate to IndexDatabaseService
    return this.indexDatabaseService.removeFolderFromIndex(folderId, folderPath).pipe(
      tap(success => {
        if (success) {
          console.log(`Successfully removed folder from index: ${folderName}`);
        } else {
          console.error(`Error removing folder from index: ${folderName}`);
        }
      }),
      catchError(error => {
        console.error(`Error removing folder from index: ${folderName}`, error);
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
   * Save current status to localStorage
   */
  private saveStatus(): void {
    localStorage.setItem(this.STATUS_KEY, JSON.stringify(this.status));
  }

  /**
   * Categorize an error based on its type and message
   * @param error The error object
   * @param folderPath Optional folder path associated with the error
   * @param filePath Optional file path associated with the error
   * @returns An IndexationError object with categorized error information
   * @deprecated Use FileIndexingService.categorizeError instead
   */
  private categorizeError(error: any, folderPath?: string, filePath?: string): IndexationError {
    // Use FileIndexingService for error categorization
    const categorizedError = this.fileIndexingService.categorizeError(error, folderPath, filePath);

    return {
      timestamp: new Date(),
      folderPath: folderPath || 'unknown',
      filePath: filePath || 'unknown',
      error: categorizedError.error,
      errorType: categorizedError.errorType,
      details: categorizedError.details
    };
  }

  /**
   * Call Electron IPC to index a folder
   * @param folder The folder to index
   * @param cancellationToken Optional cancellation token to cancel the operation
   */
  private async invokeIndexFolder(folder: Folder, cancellationToken?: CancellationToken): Promise<any> {
    try {
      console.log(`Indexing folder: ${folder.name} (${folder.path})`);

      // Update status to indicate indexing is in progress
      this.status.inProgress = true;
      this.status.currentFolder = folder.path;
      this.status.error = undefined;
      this.saveStatus();

      // Check if operation was cancelled before starting
      if (cancellationToken && cancellationToken.isCancelled) {
        console.log(`Indexation of folder ${folder.name} was cancelled before starting`);
        return {
          success: false,
          error: 'Operation cancelled by user',
          errorType: IndexationErrorType.CANCELLED,
          details: { folderPath: folder.path }
        };
      }

      // Pass cancellation information to the main process
      const result = await this.electronWindowService.indexFolder(folder.path, {
        canBeCancelled: !!cancellationToken
      });

      // Check periodically if the operation has been cancelled
      const checkCancellation = () => {
        if (cancellationToken && cancellationToken.isCancelled) {
          // Send cancellation request to main process
          this.electronWindowService.cancelFolderIndexation(folder.path)
            .catch(err => console.error('Error cancelling indexation:', err));
          return true;
        }
        return false;
      };

      // Set up cancellation checking interval
      let cancellationInterval: any;
      if (cancellationToken) {
        cancellationInterval = setInterval(checkCancellation, 500);
      }

      try {
        // Wait for the result
        if (result.success) {
          // The folder stats are now updated by the handleIndexationProgressUpdate method
          // which is called when we receive progress updates from the main process

          // Update the folder object with indexing progress
          folder.indexedFiles = result.filesIndexed || 0;
          folder.totalFiles = result.totalFiles || result.filesIndexed || 0;
          folder.indexingProgress = result.totalFiles > 0
            ? Math.round((result.filesIndexed / result.totalFiles) * 100)
            : 100;

          // Update status to indicate indexing is complete for this folder
          if (this.status.currentFolder === folder.path) {
            this.status.currentFolder = undefined;
            this.status.currentFile = undefined;
            this.status.progress = 100;
            this.saveStatus();
          }
        } else if (result.error) {
          // Check if the error was due to cancellation
          if (result.errorType === IndexationErrorType.CANCELLED ||
              (cancellationToken && cancellationToken.isCancelled)) {
            return {
              success: false,
              error: 'Operation cancelled by user',
              errorType: IndexationErrorType.CANCELLED,
              details: { folderPath: folder.path }
            };
          }

          // Handle other errors from the result
          const errorInfo = this.categorizeError(result.error, folder.path);
          console.error(`Error indexing folder ${folder.name}:`, errorInfo);

          // Update status to indicate error
          this.status.error = `Error indexing folder ${folder.name}: ${errorInfo.error}`;
          this.saveStatus();

          // Return detailed error information
          return {
            success: false,
            error: errorInfo.error,
            errorType: errorInfo.errorType,
            details: errorInfo.details
          };
        }

        return result;
      } finally {
        // Clean up the cancellation interval
        if (cancellationInterval) {
          clearInterval(cancellationInterval);
        }
      }
    } catch (error) {
      // Check if the error was due to cancellation
      if (cancellationToken && cancellationToken.isCancelled) {
        return {
          success: false,
          error: 'Operation cancelled by user',
          errorType: IndexationErrorType.CANCELLED,
          details: { folderPath: folder.path }
        };
      }

      // Handle unexpected errors
      const errorInfo = this.categorizeError(error, folder.path);
      console.error('Error in invokeIndexFolder:', errorInfo);

      // Update status to indicate error
      this.status.error = `Unexpected error indexing folder ${folder.name}: ${errorInfo.error}`;
      this.saveStatus();

      // Return detailed error information
      return {
        success: false,
        error: errorInfo.error,
        errorType: errorInfo.errorType,
        details: errorInfo.details
      };
    }
  }

  /**
   * Call Electron IPC to index all folders
   * @param folders Array of folders to index
   * @param cancellationToken Optional cancellation token to cancel the operation
   */
  private async invokeIndexAllFolders(folders: Folder[], cancellationToken?: CancellationToken): Promise<any> {
    try {
      console.log(`Indexing ${folders.length} folders`);

      // Update status to indicate indexing is in progress
      this.status.inProgress = true;
      this.status.currentFolder = 'Multiple folders';
      this.status.error = undefined;
      this.saveStatus();

      // Check if operation was cancelled before starting
      if (cancellationToken && cancellationToken.isCancelled) {
        console.log('Indexation of all folders was cancelled before starting');
        return {
          success: false,
          error: 'Operation cancelled by user',
          errorType: IndexationErrorType.CANCELLED,
          details: { folderCount: folders.length }
        };
      }

      const folderPaths = folders.map(folder => folder.path);

      // Pass cancellation information to the main process
      const result = await this.electronWindowService.indexAllFolders(folderPaths, {
        canBeCancelled: !!cancellationToken
      });

      // Check periodically if the operation has been cancelled
      const checkCancellation = () => {
        if (cancellationToken && cancellationToken.isCancelled) {
          // Send cancellation request to main process for each folder
          folderPaths.forEach(folderPath => {
            this.electronWindowService.cancelFolderIndexation(folderPath)
              .catch(err => console.error(`Error cancelling indexation for ${folderPath}:`, err));
          });
          return true;
        }
        return false;
      };

      // Set up cancellation checking interval
      let cancellationInterval: any;
      if (cancellationToken) {
        cancellationInterval = setInterval(checkCancellation, 500);
      }

      try {
        // Process the result
        if (result.success) {
          // Update status to indicate indexing is complete
          this.status.inProgress = false;
          this.status.currentFolder = undefined;
          this.status.currentFile = undefined;
          this.status.progress = 100;
          this.saveStatus();

          return result;
        } else if (result.error) {
          // Check if the error was due to cancellation
          if (result.errorType === IndexationErrorType.CANCELLED ||
              (cancellationToken && cancellationToken.isCancelled)) {
            return {
              success: false,
              error: 'Operation cancelled by user',
              errorType: IndexationErrorType.CANCELLED,
              details: { folderCount: folders.length }
            };
          }

          // Handle other errors from the result
          const errorInfo = this.categorizeError(result.error);
          console.error(`Error indexing multiple folders:`, errorInfo);

          // Update status to indicate error
          this.status.error = `Error indexing multiple folders: ${errorInfo.error}`;
          this.saveStatus();

          // Return detailed error information
          return {
            success: false,
            error: errorInfo.error,
            errorType: errorInfo.errorType,
            details: errorInfo.details
          };
        }

        return result;
      } finally {
        // Clean up the cancellation interval
        if (cancellationInterval) {
          clearInterval(cancellationInterval);
        }
      }
    } catch (error) {
      // Check if the error was due to cancellation
      if (cancellationToken && cancellationToken.isCancelled) {
        return {
          success: false,
          error: 'Operation cancelled by user',
          errorType: IndexationErrorType.CANCELLED,
          details: { folderCount: folders.length }
        };
      }

      // Handle unexpected errors
      const errorInfo = this.categorizeError(error);
      console.error('Error in invokeIndexAllFolders:', errorInfo);

      // Update status to indicate error
      this.status.error = `Unexpected error indexing multiple folders: ${errorInfo.error}`;
      this.saveStatus();

      // Return detailed error information
      return {
        success: false,
        error: errorInfo.error,
        errorType: errorInfo.errorType,
        details: errorInfo.details
      };
    }
  }

  /**
   * Call Electron IPC to start watching folders
   */
  private async invokeStartWatching(folders: Folder[]): Promise<any> {
    try {
      console.log(`Starting to watch ${folders.length} folders`);
      const folderPaths = folders.map(folder => folder.path);
      const result = await this.electronWindowService.startWatchingFolders(folderPaths);

      if (!result.success && result.error) {
        // Handle error from the result
        const errorInfo = this.categorizeError(result.error);
        console.error(`Error starting to watch folders:`, errorInfo);

        // Return detailed error information
        return {
          success: false,
          error: errorInfo.error,
          errorType: errorInfo.errorType,
          details: errorInfo.details
        };
      }

      return result;
    } catch (error) {
      // Handle unexpected errors
      const errorInfo = this.categorizeError(error);
      console.error('Error in invokeStartWatching:', errorInfo);

      // Return detailed error information
      return {
        success: false,
        error: errorInfo.error,
        errorType: errorInfo.errorType,
        details: errorInfo.details
      };
    }
  }

  /**
   * Call Electron IPC to stop watching folders
   */
  private async invokeStopWatching(): Promise<any> {
    try {
      console.log('Stopping folder watching');
      const result = await this.electronWindowService.stopWatchingFolders();

      if (!result.success && result.error) {
        // Handle error from the result
        const errorInfo = this.categorizeError(result.error);
        console.error(`Error stopping folder watching:`, errorInfo);

        // Return detailed error information
        return {
          success: false,
          error: errorInfo.error,
          errorType: errorInfo.errorType,
          details: errorInfo.details
        };
      }

      return result;
    } catch (error) {
      // Handle unexpected errors
      const errorInfo = this.categorizeError(error);
      console.error('Error in invokeStopWatching:', errorInfo);

      // Return detailed error information
      return {
        success: false,
        error: errorInfo.error,
        errorType: errorInfo.errorType,
        details: errorInfo.details
      };
    }
  }

  /**
   * Call Electron IPC to remove a file from the index
   * @param filePath Path of the file to remove
   * @param folderId ID of the folder containing the file
   */
  private async invokeRemoveFileFromIndex(filePath: string, folderId: string): Promise<any> {
    try {
      console.log(`Removing file from index: ${filePath}`);
      const result = await this.electronWindowService.removeFileFromIndex(filePath, folderId);

      if (!result.success && result.error) {
        // Handle error from the result
        const errorInfo = this.categorizeError(result.error, undefined, filePath);
        console.error(`Error removing file from index:`, errorInfo);

        // Return detailed error information
        return {
          success: false,
          error: errorInfo.error,
          errorType: errorInfo.errorType,
          details: errorInfo.details
        };
      }

      return result;
    } catch (error) {
      // Handle unexpected errors
      const errorInfo = this.categorizeError(error, undefined, filePath);
      console.error('Error in invokeRemoveFileFromIndex:', errorInfo);

      // Return detailed error information
      return {
        success: false,
        error: errorInfo.error,
        errorType: errorInfo.errorType,
        details: errorInfo.details
      };
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
