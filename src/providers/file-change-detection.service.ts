import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject, Subscription, from, of } from 'rxjs';
import { map, catchError, tap, switchMap, filter } from 'rxjs/operators';
import { ElectronWindowService } from './electron-window.service';
import { FolderWatchingService } from './folder-watching.service';
import { IncrementalIndexingService, FileChange } from './incremental-indexing.service';
import { FoldersService } from './folders.service';
import { IndexingStatusService } from './indexing-status.service';
import { IndexingErrorService, IndexationErrorType } from './indexing-error.service';

/**
 * Service responsible for detecting file changes and triggering incremental indexing
 * This service integrates folder watching with incremental indexing
 */
@Injectable({
  providedIn: 'root'
})
export class FileChangeDetectionService implements OnDestroy {
  private fileChangeSubscription: Subscription | null = null;
  private pendingChanges: Map<string, FileChange[]> = new Map();
  private processingChanges = false;
  private changeProcessingInterval: any = null;
  private folderIdCache: Map<string, string> = new Map();

  // Subject for file change events
  private fileChangeSubject = new Subject<{
    type: 'add' | 'change' | 'unlink',
    path: string,
    folderId: string,
    timestamp: Date
  }>();

  // Observable for file change events
  public fileChanges$ = this.fileChangeSubject.asObservable();

  constructor(
    private electronWindowService: ElectronWindowService,
    private folderWatchingService: FolderWatchingService,
    private incrementalIndexingService: IncrementalIndexingService,
    private foldersService: FoldersService,
    private indexingStatusService: IndexingStatusService,
    private indexingErrorService: IndexingErrorService
  ) {
    // Start processing changes at regular intervals
    this.startChangeProcessing();
  }

  ngOnDestroy(): void {
    this.stopChangeProcessing();
    if (this.fileChangeSubscription) {
      this.fileChangeSubscription.unsubscribe();
      this.fileChangeSubscription = null;
    }
  }

  /**
   * Start listening for file changes
   */
  startFileChangeDetection(): Observable<boolean> {
    // If already listening, return success
    if (this.fileChangeSubscription) {
      return of(true);
    }

    // Subscribe to file change events from Electron
    this.fileChangeSubscription = this.electronWindowService.onFileChange((event) => {
      this.handleFileChange(event);
    });

    return of(true);
  }

  /**
   * Stop listening for file changes
   */
  stopFileChangeDetection(): Observable<boolean> {
    if (this.fileChangeSubscription) {
      this.fileChangeSubscription.unsubscribe();
      this.fileChangeSubscription = null;
    }
    return of(true);
  }

  /**
   * Handle a file change event
   * @param event File change event from Electron
   */
  private handleFileChange(event: any): void {
    const { type, path, stats } = event;

    // Skip if not a valid change type
    if (type !== 'add' && type !== 'change' && type !== 'unlink') {
      return;
    }

    // Find the folder that contains this file
    this.findFolderForFile(path).subscribe({
      next: (folderId) => {
        if (!folderId) {
          console.log(`No folder found for file: ${path}`);
          return;
        }

        // Create a file change object
        const fileChange: FileChange = {
          path,
          type: type as 'add' | 'change' | 'unlink',
          timestamp: new Date()
        };

        // Add to pending changes
        this.addPendingChange(folderId, fileChange);

        // Emit the change event
        this.fileChangeSubject.next({
          type: fileChange.type,
          path: fileChange.path,
          folderId,
          timestamp: fileChange.timestamp
        });
      },
      error: (error) => {
        console.error(`Error finding folder for file: ${path}`, error);
        this.indexingErrorService.logError({
          type: IndexationErrorType.FILE_CHANGE_DETECTION,
          message: `Error finding folder for file: ${path}`,
          details: error.toString(),
          path
        });
      }
    });
  }

  /**
   * Find the folder ID for a file path
   * @param filePath Path of the file
   */
  private findFolderForFile(filePath: string): Observable<string | null> {
    // Check cache first
    for (const [folderPath, folderId] of this.folderIdCache.entries()) {
      if (filePath.startsWith(folderPath)) {
        return of(folderId);
      }
    }

    // Get all folders and find the one that contains this file
    return this.foldersService.getFolders().pipe(
      map(folders => {
        // Find the folder with the longest matching path
        let bestMatch: { path: string, id: string } | null = null;

        for (const folder of folders) {
          // Normalize paths for comparison
          const normalizedFolderPath = folder.path.replace(/[\/\\]+/g, '\\');
          const normalizedFilePath = filePath.replace(/[\/\\]+/g, '\\');

          if (normalizedFilePath.startsWith(normalizedFolderPath)) {
            if (!bestMatch || normalizedFolderPath.length > bestMatch.path.length) {
              bestMatch = { path: normalizedFolderPath, id: folder.id };
            }
          }
        }

        // Cache the result
        if (bestMatch) {
          this.folderIdCache.set(bestMatch.path, bestMatch.id);
          return bestMatch.id;
        }

        return null;
      }),
      catchError(error => {
        console.error('Error getting folders:', error);
        return of(null);
      })
    );
  }

  /**
   * Add a pending change to the queue
   * @param folderId ID of the folder
   * @param change File change to add
   */
  private addPendingChange(folderId: string, change: FileChange): void {
    if (!this.pendingChanges.has(folderId)) {
      this.pendingChanges.set(folderId, []);
    }

    this.pendingChanges.get(folderId)!.push(change);
  }

  /**
   * Start processing changes at regular intervals
   */
  private startChangeProcessing(): void {
    if (this.changeProcessingInterval) {
      return;
    }

    // Process changes every 5 seconds
    this.changeProcessingInterval = setInterval(() => {
      this.processChanges();
    }, 5000);
  }

  /**
   * Stop processing changes
   */
  private stopChangeProcessing(): void {
    if (this.changeProcessingInterval) {
      clearInterval(this.changeProcessingInterval);
      this.changeProcessingInterval = null;
    }
  }

  /**
   * Process pending changes
   */
  private processChanges(): void {
    // Skip if already processing or no changes
    if (this.processingChanges || this.pendingChanges.size === 0) {
      return;
    }

    this.processingChanges = true;

    // Get all folders
    this.foldersService.getFolders().subscribe({
      next: (folders) => {
        // Process changes for each folder
        const folderMap = new Map(folders.map(f => [f.id, f]));
        const folderIds = Array.from(this.pendingChanges.keys());

        // Process each folder's changes
        const processNextFolder = (index: number) => {
          if (index >= folderIds.length) {
            this.processingChanges = false;
            return;
          }

          const folderId = folderIds[index];
          const folder = folderMap.get(folderId);

          if (!folder) {
            // Folder not found, skip
            this.pendingChanges.delete(folderId);
            processNextFolder(index + 1);
            return;
          }

          const changes = this.pendingChanges.get(folderId) || [];
          if (changes.length === 0) {
            // No changes for this folder, skip
            this.pendingChanges.delete(folderId);
            processNextFolder(index + 1);
            return;
          }

          console.log(`Processing ${changes.length} changes for folder: ${folder.path}`);

          // Process changes for this folder
          this.incrementalIndexingService.processFileChanges(folderId, folder.path, changes)
            .subscribe({
              next: (processedCount) => {
                console.log(`Processed ${processedCount} changes for folder: ${folder.path}`);

                // Clear processed changes
                this.pendingChanges.delete(folderId);

                // Process next folder
                processNextFolder(index + 1);
              },
              error: (error) => {
                console.error(`Error processing changes for folder: ${folder.path}`, error);

                // Log the error
                this.indexingErrorService.logError({
                  type: IndexationErrorType.INCREMENTAL_INDEXING,
                  message: `Error processing changes for folder: ${folder.path}`,
                  details: error.toString(),
                  path: folder.path
                });

                // Clear processed changes to avoid retrying the same failed changes
                this.pendingChanges.delete(folderId);

                // Process next folder
                processNextFolder(index + 1);
              }
            });
        };

        // Start processing folders
        processNextFolder(0);
      },
      error: (error) => {
        console.error('Error getting folders:', error);
        this.processingChanges = false;
      }
    });
  }

  /**
   * Force processing of pending changes immediately
   */
  forceProcessChanges(): Observable<boolean> {
    // Skip if already processing or no changes
    if (this.processingChanges || this.pendingChanges.size === 0) {
      return of(true);
    }

    // Process changes
    this.processChanges();
    return of(true);
  }

  /**
   * Get the number of pending changes
   */
  getPendingChangeCount(): number {
    let count = 0;
    for (const changes of this.pendingChanges.values()) {
      count += changes.length;
    }
    return count;
  }

  /**
   * Clear all pending changes
   */
  clearPendingChanges(): void {
    this.pendingChanges.clear();
  }
}
