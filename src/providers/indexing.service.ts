import { Injectable, OnDestroy } from '@angular/core';
import { Observable, from, of, Subscription } from 'rxjs';
import { map, catchError, tap, switchMap } from 'rxjs/operators';
import { FoldersService } from './folders.service';
import { ElectronWindowService, IndexationProgressUpdate } from './electron-window.service';
import { Folder } from '../components/folders/folders.component';
import { FileIndexingService } from './file-indexing.service';
import { IndexDatabaseService, IndexedFile } from './index-database.service';
import { IncrementalIndexingService } from './incremental-indexing.service';
import { IndexingStatusService, IndexingStatus } from './indexing-status.service';
import { FolderStatisticsService, FolderIndexingStats } from './folder-statistics.service';
import { IndexingErrorService, IndexationErrorType, IndexationError } from './indexing-error.service';
import { FolderWatchingService } from './folder-watching.service';
import { IndexingIPCService } from './indexing-ipc.service';

// Re-export interfaces and classes from other services for backward compatibility
export type { IndexingStatus } from './indexing-status.service';
export type { FolderIndexingStats } from './folder-statistics.service';
export type { IndexationErrorType, IndexationError } from './indexing-error.service';
export type { IndexedFile } from './index-database.service';

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

/**
 * Service responsible for coordinating the indexing process
 * This service delegates responsibilities to more focused services
 */
@Injectable({
  providedIn: 'root'
})
export class IndexingService implements OnDestroy {
  private subscriptions: Subscription[] = [];

  constructor(
    private foldersService: FoldersService,
    private electronWindowService: ElectronWindowService,
    private fileIndexingService: FileIndexingService,
    private indexDatabaseService: IndexDatabaseService,
    private incrementalIndexingService: IncrementalIndexingService,
    private indexingStatusService: IndexingStatusService,
    private folderStatisticsService: FolderStatisticsService,
    private indexingErrorService: IndexingErrorService,
    private folderWatchingService: FolderWatchingService,
    private indexingIPCService: IndexingIPCService
  ) {
    // Subscribe to indexation progress updates
    this.subscriptions.push(
      this.electronWindowService.indexationProgress$.subscribe(update => {
        this.handleIndexationProgressUpdate(update);
      })
    );

    // Subscribe to batch file save updates
    this.subscriptions.push(
      this.electronWindowService.indexedFilesBatch$.subscribe(data => {
        // Log the batch save notification
        console.log(`Batch of ${data.filesCount} files saved to database (${data.errorsCount} errors)`);

        // If we have folder-specific counts, update the folder stats
        if (data.folderCounts) {
          Object.entries(data.folderCounts).forEach(([folderPath, info]) => {
            const folderId = info.folderId;
            const count = info.count;

            // Only update stats if we have a valid folder ID
            if (folderId) {
              // Increment indexed files count for this folder
              this.folderStatisticsService.incrementIndexedFiles(folderId, count);
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
        // Just log the removal notification
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
    // Check if we have files in queue information
    const filesInQueue = update.filesInQueue !== undefined ? update.filesInQueue : 0;

    // Determine status based on progress, status field, and files in queue
    const inProgress = (update.progress < 100 || filesInQueue > 0) && update.status !== 'stopped';

    // Update the indexing status
    if (inProgress) {
      // Update progress
      this.indexingStatusService.updateProgress(
        update.progress,
        update.currentFile,
        update.indexedFiles,
        update.totalFiles,
        undefined, // successfulFiles
        undefined, // failedFiles
        undefined, // skippedFiles
        {
          // Include files in queue information for more accurate progress reporting
          filesInQueue: filesInQueue
        }
      );

      // Update error count if available
      if (update.errors !== undefined) {
        this.indexingStatusService.setError('', update.errors);
      }
    } else {
      // Complete indexing
      const success = update.status !== 'stopped' && update.progress === 100;
      this.indexingStatusService.completeIndexing(success);
    }

    // Update the folder statistics
    this.folderStatisticsService.updateFolderStats(update.folderId, {
      indexedFiles: update.indexedFiles,
      totalFiles: update.totalFiles,
      filesInQueue: filesInQueue
    });

    // Update folder status
    const folderStatus = update.status === 'stopped'
      ? 'stopped'
      : (inProgress ? 'indexing' : 'indexed');
    this.folderStatisticsService.setFolderStatus(update.folderId, folderStatus);

    // If indexation is complete (progress = 100% and no files in queue), make sure we persist the final state
    if (update.progress === 100 && filesInQueue === 0) {
      // Give it a short delay to ensure all updates are processed
      setTimeout(() => {
        // Ensure the status is saved with the correct progress
        this.indexingStatusService.completeIndexing(true);
      }, 500);
    }
  }

  /**
   * Handle request from main process to get folder ID for a path
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
          // Send empty response back to main process
          this.indexingIPCService.sendFolderIdResponse({
            success: false,
            error: 'Folder not found',
            folderId: null,
            folderPath: data.folderPath
          });
          return;
        }

        // Send response back to main process with folder ID
        this.indexingIPCService.sendFolderIdResponse({
          success: true,
          folderId: folder.id,
          folderPath: data.folderPath
        });
      },
      error => {
        console.error('Error getting folders:', error);
        // Send error response back to main process
        this.indexingIPCService.sendFolderIdResponse({
          success: false,
          error: error.toString(),
          folderId: null,
          folderPath: data.folderPath
        });
      }
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
          this.indexingIPCService.sendIndexedFilesResponse({
            success: false,
            error: 'Folder not found',
            files: [],
            folderPath: data.folderPath
          });
          return;
        }

        // Send response back to main process with folder ID
        // The main process will now query the SQLite database directly
        this.indexingIPCService.sendIndexedFilesResponse({
          success: true,
          folderId: folder.id,
          folderPath: data.folderPath
        });
      },
      error => {
        console.error('Error getting folders:', error);
        // Send error response back to main process
        this.indexingIPCService.sendIndexedFilesResponse({
          success: false,
          error: error.toString(),
          files: [],
          folderPath: data.folderPath
        });
      }
    );
  }

  /**
   * Start indexing a specific folder
   * @param folder The folder to index
   * @param cancellationToken Optional cancellation token to cancel the operation
   */
  indexFolder(folder: Folder, cancellationToken?: CancellationToken): Observable<boolean> {
    // Create a new cancellation token if one wasn't provided
    const token = cancellationToken || new CancellationToken();

    // Update status with cancellation token
    this.indexingStatusService.startIndexing(folder.name, token);

    // Register a callback to update status when cancelled
    const unregisterCallback = token.onCancel(() => {
      console.log(`Indexation of folder ${folder.name} was cancelled`);
      this.indexingStatusService.cancelIndexing();
    });

    // Call the Electron main process to read and index files
    return from(this.indexingIPCService.invokeIndexFolder(folder, token)).pipe(
      tap(result => {
        console.log('Folder indexation completed:', result);

        // Ensure the folder stats are updated with the final values
        if (result.success) {
          this.folderStatisticsService.updateFolderStats(folder.id, {
            indexedFiles: result.filesIndexed || 0,
            totalFiles: result.totalFiles || result.filesIndexed || 0,
            status: 'indexed'
          });
        }

        // Clean up the cancellation callback
        unregisterCallback();
      }),
      catchError(error => {
        console.error('Error indexing folder:', error);

        // Check if the error was due to cancellation
        const wasCancelled = token.isCancelled;

        // Update status
        this.indexingStatusService.completeIndexing(false, wasCancelled ? 'Indexation cancelled by user' : error.toString());

        // Update folder status
        this.folderStatisticsService.setFolderStatus(folder.id, 'stopped');

        // Clean up the cancellation callback
        unregisterCallback();

        throw error;
      })
    );
  }

  /**
   * Start indexing all folders
   * @param cancellationToken Optional cancellation token to cancel the operation
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
        this.indexingStatusService.startIndexing('All folders', token);

        // Register a callback to update status when cancelled
        const unregisterCallback = token.onCancel(() => {
          console.log('Indexation of all folders was cancelled');
          this.indexingStatusService.cancelIndexing();
        });

        // Call the Electron main process to read and index files
        return from(this.indexingIPCService.invokeIndexAllFolders(folders, token)).pipe(
          tap(result => {
            console.log('All folders indexation completed:', result);

            // Clean up the cancellation callback
            unregisterCallback();
          }),
          catchError(error => {
            console.error('Error indexing all folders:', error);

            // Check if the error was due to cancellation
            const wasCancelled = token.isCancelled;

            // Update status
            this.indexingStatusService.completeIndexing(false, wasCancelled ? 'Indexation cancelled by user' : error.toString());

            // Clean up the cancellation callback
            unregisterCallback();

            throw error;
          })
        );
      })
    );
  }

  /**
   * Start watching folders for changes
   */
  startWatchingFolders(): Observable<boolean> {
    return this.foldersService.getFolders().pipe(
      switchMap(folders => this.folderWatchingService.startWatchingFolders(folders))
    );
  }

  /**
   * Stop watching all folders
   */
  stopWatchingFolders(): Observable<boolean> {
    return this.folderWatchingService.stopWatchingFolders();
  }

  /**
   * Stop folder indexation
   * @param folderPath Path of the folder to stop indexing
   */
  stopFolderIndexation(folderPath: string): Observable<boolean> {
    return this.indexingIPCService.stopFolderIndexation(folderPath);
  }

  /**
   * Get the current indexing status
   */
  getIndexingStatus(): IndexingStatus {
    return this.indexingStatusService.getStatus();
  }

  /**
   * Get an observable of the indexing status
   */
  getIndexingStatus$(): Observable<IndexingStatus> {
    return this.indexingStatusService.getStatus$();
  }

  /**
   * Reset the indexing status to default values
   */
  resetIndexingStatus(): void {
    this.indexingStatusService.resetStatus();
  }

  /**
   * Get statistics for a specific folder
   * @param folderId The ID of the folder
   */
  getFolderIndexingStats(folderId: string): FolderIndexingStats | undefined {
    return this.folderStatisticsService.getFolderStats(folderId);
  }

  /**
   * Get an observable of statistics for a specific folder
   * @param folderId The ID of the folder
   */
  getFolderIndexingStats$(folderId: string): Observable<FolderIndexingStats | undefined> {
    return this.folderStatisticsService.getFolderStats$(folderId);
  }

  /**
   * Get all folder statistics
   */
  getAllFolderIndexingStats(): Map<string, FolderIndexingStats> {
    return this.folderStatisticsService.getAllFolderStats();
  }

  /**
   * Get an observable of all folder statistics
   */
  getAllFolderIndexingStats$(): Observable<Map<string, FolderIndexingStats>> {
    return this.folderStatisticsService.getAllFolderStats$();
  }

  /**
   * Update statistics for a folder
   * @param folderId The ID of the folder
   * @param stats The statistics to update
   */
  updateFolderIndexingStats(folderId: string, stats: Partial<FolderIndexingStats>): void {
    this.folderStatisticsService.updateFolderStats(folderId, stats);
  }

  /**
   * Remove statistics for a folder
   * @param folderId The ID of the folder
   */
  removeFolderIndexingStats(folderId: string): void {
    this.folderStatisticsService.removeFolderStats(folderId);
  }

  /**
   * Remove a folder from the index
   * This removes all indexed files for the folder and stops watching the folder
   * @param folder The folder to remove from the index
   * @returns Observable that completes when the folder is removed from the index
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

    // First stop watching the folder
    return this.folderWatchingService.stopWatchingFolder(folderPath).pipe(
      switchMap(() => {
        // Then remove the folder from the index
        return this.indexDatabaseService.removeFolderFromIndex(folderId, folderPath);
      }),
      tap(success => {
        if (success) {
          console.log(`Successfully removed folder from index: ${folderName}`);
          // Remove folder statistics
          this.folderStatisticsService.removeFolderStats(folderId);
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
   * Get all indexation errors
   * @param folderPath Optional folder path to filter errors
   */
  getIndexationErrors(folderPath?: string): Observable<IndexationError[]> {
    return this.indexingErrorService.getIndexationErrors(folderPath);
  }

  /**
   * Check if a folder has any indexation errors
   * @param folderPath The path of the folder to check
   */
  hasFolderIndexationErrors(folderPath: string): Observable<boolean> {
    return this.indexingErrorService.hasFolderIndexationErrors(folderPath);
  }

  /**
   * Get the number of indexation errors for a folder
   * @param folderPath The path of the folder to check
   */
  getFolderErrorCount(folderPath: string): Observable<number> {
    return this.indexingErrorService.getFolderErrorCount(folderPath);
  }

  /**
   * Clear all indexation errors
   * @param folderPath Optional folder path to clear errors for
   */
  clearIndexationErrors(folderPath?: string): Observable<boolean> {
    return this.indexingErrorService.clearIndexationErrors(folderPath);
  }

  /**
   * Clear all indexed files if there are no folders
   * This is used to clean up the database when all folders are removed
   */
  clearIndexedFilesIfNoFolders(): Observable<boolean> {
    return this.foldersService.getFolders().pipe(
      switchMap(folders => {
        if (folders.length === 0) {
          console.log('No folders found, clearing all indexed files');
          return this.indexDatabaseService.clearAllIndexedFiles().pipe(
            tap(result => {
              if (result) {
                console.log('All indexed files cleared');
              } else {
                console.error('Error clearing all indexed files');
              }
            })
          );
        } else {
          console.log(`Found ${folders.length} folders, not clearing indexed files`);
          return of(false);
        }
      }),
      catchError(error => {
        console.error('Error checking folders:', error);
        return of(false);
      })
    );
  }
}
