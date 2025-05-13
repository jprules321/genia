import { Injectable } from '@angular/core';
import { Observable, from, of, throwError } from 'rxjs';
import { map, catchError, switchMap, tap, finalize } from 'rxjs/operators';
import { FileSystemService } from './file-system.service';
import { IndexDatabaseService, IndexedFile } from './index-database.service';
import { ContentTypeService } from './content-type.service';
import { CancellationToken } from './indexing.service';
import { ElectronWindowService } from './electron-window.service';
import { IndexingSettingsService } from './indexing-settings.service';

/**
 * Interface for a file change
 */
export interface FileChange {
  path: string;
  type: 'add' | 'change' | 'unlink';
  timestamp: Date;
}

/**
 * Interface for a file diff
 */
export interface FileDiff {
  path: string;
  oldContent: string;
  newContent: string;
  addedLines: number[];
  removedLines: number[];
  changedLines: number[];
}

/**
 * Interface for indexing state used for resuming interrupted indexing
 */
export interface IndexingState {
  folderId: string;
  folderPath: string;
  pendingChanges: FileChange[];
  processedPaths: string[];
  lastUpdated: Date;
  isComplete: boolean;
  error?: string;
}

/**
 * Interface for a resumable indexing session
 */
export interface ResumableIndexingSession {
  id: string;
  state: IndexingState;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Service responsible for incremental indexing of files
 * This service is used to improve performance by only indexing changed portions of files
 */
@Injectable({
  providedIn: 'root'
})
export class IncrementalIndexingService {
  // Store active indexing sessions
  private activeIndexingSessions: Map<string, ResumableIndexingSession> = new Map();

  constructor(
    private fileSystemService: FileSystemService,
    private indexDatabaseService: IndexDatabaseService,
    private contentTypeService: ContentTypeService,
    private electronWindowService: ElectronWindowService,
    private indexingSettingsService: IndexingSettingsService
  ) {
    // Load any saved indexing sessions on startup
    this.loadSavedIndexingSessions().subscribe({
      next: (sessions) => {
        console.log(`Loaded ${sessions.length} saved indexing sessions`);

        // Add sessions to active sessions map
        for (const session of sessions) {
          this.activeIndexingSessions.set(session.id, session);
        }

        // Check for incomplete sessions that can be resumed
        const incompleteSessions = sessions.filter(s => !s.state.isComplete);
        if (incompleteSessions.length > 0) {
          console.log(`Found ${incompleteSessions.length} incomplete indexing sessions that can be resumed`);
        }
      },
      error: (error) => {
        console.error('Error loading saved indexing sessions:', error);
      }
    });
  }

  /**
   * Process file changes for a folder
   * @param folderId ID of the folder
   * @param folderPath Path of the folder
   * @param changes Array of file changes
   * @param cancellationToken Optional cancellation token to cancel the operation
   */
  processFileChanges(
    folderId: string,
    folderPath: string,
    changes: FileChange[],
    cancellationToken?: CancellationToken
  ): Observable<number> {
    // Check if operation was cancelled before starting
    if (cancellationToken && cancellationToken.isCancelled) {
      console.log(`Processing of file changes for folder ${folderPath} was cancelled before starting`);
      return of(0);
    }

    // Group changes by file path
    const changesByPath = this.groupChangesByPath(changes);

    // Process each file
    let processedCount = 0;

    // Return an observable that processes each file
    return new Observable(subscriber => {
      // Process files one by one
      const processNextFile = (index: number) => {
        // Check if we're done
        if (index >= Object.keys(changesByPath).length) {
          subscriber.next(processedCount);
          subscriber.complete();
          return;
        }

        // Check if operation was cancelled
        if (cancellationToken && cancellationToken.isCancelled) {
          console.log(`Processing of file changes for folder ${folderPath} was cancelled`);
          subscriber.next(processedCount);
          subscriber.complete();
          return;
        }

        // Get the file path and changes
        const filePath = Object.keys(changesByPath)[index];
        const fileChanges = changesByPath[filePath];

        // Process the file
        this.processFileChange(folderId, folderPath, filePath, fileChanges)
          .subscribe({
            next: (processed) => {
              if (processed) {
                processedCount++;
              }

              // Process the next file
              processNextFile(index + 1);
            },
            error: (error) => {
              console.error(`Error processing file change for ${filePath}:`, error);

              // Process the next file
              processNextFile(index + 1);
            }
          });
      };

      // Start processing files
      processNextFile(0);
    });
  }

  /**
   * Group file changes by path
   * @param changes Array of file changes
   * @returns Object mapping file paths to arrays of changes
   */
  private groupChangesByPath(changes: FileChange[]): { [path: string]: FileChange[] } {
    const changesByPath: { [path: string]: FileChange[] } = {};

    for (const change of changes) {
      if (!changesByPath[change.path]) {
        changesByPath[change.path] = [];
      }

      changesByPath[change.path].push(change);
    }

    return changesByPath;
  }

  /**
   * Process a file change
   * @param folderId ID of the folder
   * @param folderPath Path of the folder
   * @param filePath Path of the file
   * @param changes Array of changes for the file
   */
  private processFileChange(
    folderId: string,
    folderPath: string,
    filePath: string,
    changes: FileChange[]
  ): Observable<boolean> {
    // Sort changes by timestamp
    changes.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Get the latest change
    const latestChange = changes[changes.length - 1];

    // If the latest change is 'unlink', remove the file from the index
    if (latestChange.type === 'unlink') {
      return this.indexDatabaseService.removeFileFromIndex(filePath, folderId);
    }

    // Otherwise, get the file stats
    return this.fileSystemService.getFileStats(filePath).pipe(
      switchMap(stats => {
        // Check if the file is indexable
        return this.contentTypeService.isFileIndexable(filePath, stats.size).pipe(
          switchMap(result => {
            if (!result.indexable) {
              console.log(`File ${filePath} is not indexable: ${result.reason}`);
              return of(false);
            }

            // Get the existing indexed file
            return this.indexDatabaseService.getIndexedFilesForFolder(folderId, folderPath).pipe(
              switchMap(indexedFiles => {
                // Find the indexed file
                const indexedFile = indexedFiles.find(file => file.path === filePath);

                // If the file is not indexed, index it
                if (!indexedFile) {
                  return this.indexNewFile(folderId, filePath, stats.lastModified);
                }

                // If the file is indexed, check if it has changed
                if (stats.lastModified.getTime() > indexedFile.lastModified.getTime()) {
                  return this.updateIndexedFile(indexedFile, stats.lastModified);
                }

                // File hasn't changed
                return of(false);
              })
            );
          })
        );
      }),
      catchError(error => {
        console.error(`Error processing file change for ${filePath}:`, error);
        return of(false);
      })
    );
  }

  /**
   * Index a new file
   * @param folderId ID of the folder
   * @param filePath Path of the file
   * @param lastModified Last modified date of the file
   */
  private indexNewFile(
    folderId: string,
    filePath: string,
    lastModified: Date
  ): Observable<boolean> {
    // Get the content type
    return this.contentTypeService.getContentTypeInfo(filePath).pipe(
      switchMap(contentType => {
        // Read the file content
        return this.fileSystemService.readFileContent(filePath).pipe(
          switchMap(content => {
            // Create a new indexed file
            const filename = filePath.split(/[\/\\]/).pop() || '';
            const indexedFile: IndexedFile = {
              id: `${folderId}_${filename}`,
              folderId,
              path: filePath,
              filename,
              content,
              lastIndexed: new Date(),
              lastModified
            };

            // Save the indexed file
            return this.indexDatabaseService.saveIndexedFile(indexedFile);
          })
        );
      }),
      catchError(error => {
        console.error(`Error indexing new file ${filePath}:`, error);
        return of(false);
      })
    );
  }

  /**
   * Update an indexed file
   * @param indexedFile The existing indexed file
   * @param lastModified Last modified date of the file
   */
  private updateIndexedFile(
    indexedFile: IndexedFile,
    lastModified: Date
  ): Observable<boolean> {
    // Read the file content
    return this.fileSystemService.readFileContent(indexedFile.path).pipe(
      switchMap(newContent => {
        // If the content hasn't changed, just update the last modified date
        if (newContent === indexedFile.content) {
          indexedFile.lastModified = lastModified;
          indexedFile.lastIndexed = new Date();
          return this.indexDatabaseService.saveIndexedFile(indexedFile);
        }

        // Calculate the diff
        const diff = this.calculateDiff(indexedFile.content, newContent);

        // Update the indexed file
        indexedFile.content = newContent;
        indexedFile.lastModified = lastModified;
        indexedFile.lastIndexed = new Date();

        // Save the indexed file
        return this.indexDatabaseService.saveIndexedFile(indexedFile);
      }),
      catchError(error => {
        console.error(`Error updating indexed file ${indexedFile.path}:`, error);
        return of(false);
      })
    );
  }

  /**
   * Calculate the diff between two strings using the Myers diff algorithm
   * @param oldContent The old content
   * @param newContent The new content
   * @returns A FileDiff object
   */
  private calculateDiff(oldContent: string, newContent: string): FileDiff {
    // Split the content into lines
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    // Initialize arrays for added, removed, and changed lines
    const addedLines: number[] = [];
    const removedLines: number[] = [];
    const changedLines: number[] = [];

    // Implement Myers diff algorithm for better diff calculation
    const diffResult = this.myersDiff(oldLines, newLines);

    // Process the diff result
    let oldIndex = 0;
    let newIndex = 0;

    for (const edit of diffResult) {
      if (edit.type === 'equal') {
        // Lines are equal, just advance the indices
        oldIndex += edit.count;
        newIndex += edit.count;
      } else if (edit.type === 'insert') {
        // Lines were added
        for (let i = 0; i < edit.count; i++) {
          addedLines.push(newIndex + i);
        }
        newIndex += edit.count;
      } else if (edit.type === 'delete') {
        // Lines were removed
        for (let i = 0; i < edit.count; i++) {
          removedLines.push(oldIndex + i);
        }
        oldIndex += edit.count;
      } else if (edit.type === 'replace') {
        // Lines were changed
        for (let i = 0; i < edit.count; i++) {
          if (oldIndex + i < oldLines.length) {
            changedLines.push(oldIndex + i);
          }
        }
        oldIndex += edit.count;
        newIndex += edit.count;
      }
    }

    return {
      path: '',
      oldContent,
      newContent,
      addedLines,
      removedLines,
      changedLines
    };
  }

  /**
   * Implement the Myers diff algorithm for finding the shortest edit script
   * @param oldLines Array of old lines
   * @param newLines Array of new lines
   * @returns Array of edit operations
   */
  private myersDiff(oldLines: string[], newLines: string[]): Array<{
    type: 'equal' | 'insert' | 'delete' | 'replace';
    count: number;
  }> {
    const MAX_EDIT_LENGTH = 10000; // Limit for very large files
    const n = oldLines.length;
    const m = newLines.length;

    // Handle edge cases
    if (n === 0 && m === 0) {
      return [];
    }
    if (n === 0) {
      return [{ type: 'insert' as const, count: m }];
    }
    if (m === 0) {
      return [{ type: 'delete' as const, count: n }];
    }

    // Check if files are too large for detailed diff
    if (n > MAX_EDIT_LENGTH || m > MAX_EDIT_LENGTH) {
      console.log(`Files too large for detailed diff (${n} vs ${m} lines), using simplified algorithm`);
      return this.simplifiedDiff(oldLines, newLines);
    }

    // Find common prefix and suffix to reduce the problem size
    let prefixLength = 0;
    while (prefixLength < Math.min(n, m) && oldLines[prefixLength] === newLines[prefixLength]) {
      prefixLength++;
    }

    let suffixLength = 0;
    while (
      suffixLength < Math.min(n - prefixLength, m - prefixLength) &&
      oldLines[n - suffixLength - 1] === newLines[m - suffixLength - 1]
    ) {
      suffixLength++;
    }

    // Adjust the arrays to exclude common prefix and suffix
    const oldMiddle = oldLines.slice(prefixLength, n - suffixLength);
    const newMiddle = newLines.slice(prefixLength, m - suffixLength);

    // If the middle parts are empty, we're done
    if (oldMiddle.length === 0 && newMiddle.length === 0) {
      return prefixLength > 0 ? [{ type: 'equal' as const, count: prefixLength }] : [];
    }

    // If one of the middle parts is empty, we have a simple case
    if (oldMiddle.length === 0) {
      return [
        ...(prefixLength > 0 ? [{ type: 'equal' as const, count: prefixLength }] : []),
        { type: 'insert' as const, count: newMiddle.length },
        ...(suffixLength > 0 ? [{ type: 'equal' as const, count: suffixLength }] : [])
      ];
    }
    if (newMiddle.length === 0) {
      return [
        ...(prefixLength > 0 ? [{ type: 'equal' as const, count: prefixLength }] : []),
        { type: 'delete' as const, count: oldMiddle.length },
        ...(suffixLength > 0 ? [{ type: 'equal' as const, count: suffixLength }] : [])
      ];
    }

    // For the middle part, use a simplified algorithm for large files
    const middleResult = this.computeMiddleDiff(oldMiddle, newMiddle);

    // Combine the results
    return [
      ...(prefixLength > 0 ? [{ type: 'equal' as const, count: prefixLength }] : []),
      ...middleResult,
      ...(suffixLength > 0 ? [{ type: 'equal' as const, count: suffixLength }] : [])
    ];
  }

  /**
   * Compute the diff for the middle part of the files
   * @param oldLines Array of old lines
   * @param newLines Array of new lines
   * @returns Array of edit operations
   */
  private computeMiddleDiff(oldLines: string[], newLines: string[]): Array<{
    type: 'equal' | 'insert' | 'delete' | 'replace';
    count: number;
  }> {
    const n = oldLines.length;
    const m = newLines.length;

    // For very different files, just replace everything
    if (Math.abs(n - m) > Math.max(n, m) * 0.7) {
      return [
        { type: 'delete' as const, count: n },
        { type: 'insert' as const, count: m }
      ];
    }

    // Use a line-by-line comparison approach
    const result: Array<{
      type: 'equal' | 'insert' | 'delete' | 'replace';
      count: number;
    }> = [];

    let i = 0, j = 0;

    while (i < n || j < m) {
      // Find a sequence of equal lines
      let equalCount = 0;
      while (i + equalCount < n && j + equalCount < m &&
             oldLines[i + equalCount] === newLines[j + equalCount]) {
        equalCount++;
      }

      if (equalCount > 0) {
        result.push({ type: 'equal' as const, count: equalCount });
        i += equalCount;
        j += equalCount;
        continue;
      }

      // Find the next matching line
      let oldNext = -1, newNext = -1;
      for (let k = 1; k < Math.max(n - i, m - j) && k < 100; k++) {
        if (i + k < n && j < m && oldLines[i + k] === newLines[j]) {
          oldNext = i + k;
          newNext = j;
          break;
        }
        if (i < n && j + k < m && oldLines[i] === newLines[j + k]) {
          oldNext = i;
          newNext = j + k;
          break;
        }
      }

      if (oldNext !== -1 && newNext !== -1) {
        // We found a match, handle the gap
        if (oldNext > i && newNext > j) {
          // Both sides have changes, mark as replace
          const replaceCount = Math.min(oldNext - i, newNext - j);
          result.push({ type: 'replace' as const, count: replaceCount });
          i += replaceCount;
          j += replaceCount;

          // Handle any remaining lines
          if (oldNext - i > 0) {
            result.push({ type: 'delete' as const, count: oldNext - i });
            i = oldNext;
          }
          if (newNext - j > 0) {
            result.push({ type: 'insert' as const, count: newNext - j });
            j = newNext;
          }
        } else if (oldNext > i) {
          // Only old side has changes
          result.push({ type: 'delete' as const, count: oldNext - i });
          i = oldNext;
        } else if (newNext > j) {
          // Only new side has changes
          result.push({ type: 'insert' as const, count: newNext - j });
          j = newNext;
        }
      } else {
        // No match found, mark remaining lines as delete/insert
        if (i < n) {
          result.push({ type: 'delete' as const, count: n - i });
          i = n;
        }
        if (j < m) {
          result.push({ type: 'insert' as const, count: m - j });
          j = m;
        }
      }
    }

    return result;
  }

  /**
   * Simplified diff algorithm for very large files
   * @param oldLines Array of old lines
   * @param newLines Array of new lines
   * @returns Array of edit operations
   */
  private simplifiedDiff(oldLines: string[], newLines: string[]): Array<{
    type: 'equal' | 'insert' | 'delete' | 'replace';
    count: number;
  }> {
    const n = oldLines.length;
    const m = newLines.length;

    // Find common prefix
    let prefixLength = 0;
    while (prefixLength < Math.min(n, m) && oldLines[prefixLength] === newLines[prefixLength]) {
      prefixLength++;
    }

    // Find common suffix
    let suffixLength = 0;
    while (
      suffixLength < Math.min(n - prefixLength, m - prefixLength) &&
      oldLines[n - suffixLength - 1] === newLines[m - suffixLength - 1]
    ) {
      suffixLength++;
    }

    // Build the result
    const result: Array<{
      type: 'equal' | 'insert' | 'delete' | 'replace';
      count: number;
    }> = [];

    if (prefixLength > 0) {
      result.push({ type: 'equal' as const, count: prefixLength });
    }

    const oldMiddleLength = n - prefixLength - suffixLength;
    const newMiddleLength = m - prefixLength - suffixLength;

    if (oldMiddleLength > 0 && newMiddleLength > 0) {
      // Both sides have changes, mark as replace if sizes are similar
      if (Math.abs(oldMiddleLength - newMiddleLength) < Math.max(oldMiddleLength, newMiddleLength) * 0.3) {
        result.push({ type: 'replace' as const, count: Math.min(oldMiddleLength, newMiddleLength) });

        // Handle any remaining lines
        if (oldMiddleLength > newMiddleLength) {
          result.push({ type: 'delete' as const, count: oldMiddleLength - newMiddleLength });
        } else if (newMiddleLength > oldMiddleLength) {
          result.push({ type: 'insert' as const, count: newMiddleLength - oldMiddleLength });
        }
      } else {
        // Sizes are very different, just delete and insert
        result.push({ type: 'delete' as const, count: oldMiddleLength });
        result.push({ type: 'insert' as const, count: newMiddleLength });
      }
    } else if (oldMiddleLength > 0) {
      result.push({ type: 'delete' as const, count: oldMiddleLength });
    } else if (newMiddleLength > 0) {
      result.push({ type: 'insert' as const, count: newMiddleLength });
    }

    if (suffixLength > 0) {
      result.push({ type: 'equal' as const, count: suffixLength });
    }

    return result;
  }

  /**
   * Load saved indexing sessions from storage
   * @returns Observable of saved indexing sessions
   */
  private loadSavedIndexingSessions(): Observable<ResumableIndexingSession[]> {
    return from(this.electronWindowService.invokeServiceMethod('indexingState', 'loadSessions', [])).pipe(
      map(result => {
        if (result.success) {
          return (result.sessions || []) as ResumableIndexingSession[];
        } else {
          console.error('Error loading indexing sessions:', result.error);
          return [];
        }
      }),
      catchError(error => {
        console.error('Error loading indexing sessions:', error);
        return of([]);
      })
    );
  }

  /**
   * Save an indexing session to storage
   * @param session The indexing session to save
   * @returns Observable of success status
   */
  private saveIndexingSession(session: ResumableIndexingSession): Observable<boolean> {
    return from(this.electronWindowService.invokeServiceMethod('indexingState', 'saveSession', [session])).pipe(
      map(result => {
        if (result.success) {
          return true;
        } else {
          console.error('Error saving indexing session:', result.error);
          return false;
        }
      }),
      catchError(error => {
        console.error('Error saving indexing session:', error);
        return of(false);
      })
    );
  }

  /**
   * Delete an indexing session from storage
   * @param sessionId ID of the session to delete
   * @returns Observable of success status
   */
  private deleteIndexingSession(sessionId: string): Observable<boolean> {
    return from(this.electronWindowService.invokeServiceMethod('indexingState', 'deleteSession', [sessionId])).pipe(
      map(result => {
        if (result.success) {
          // Remove from active sessions map
          this.activeIndexingSessions.delete(sessionId);
          return true;
        } else {
          console.error('Error deleting indexing session:', result.error);
          return false;
        }
      }),
      catchError(error => {
        console.error('Error deleting indexing session:', error);
        return of(false);
      })
    );
  }

  /**
   * Create a new indexing session
   * @param folderId ID of the folder
   * @param folderPath Path of the folder
   * @param changes Array of file changes
   * @returns The created session
   */
  private createIndexingSession(
    folderId: string,
    folderPath: string,
    changes: FileChange[]
  ): ResumableIndexingSession {
    const sessionId = `${folderId}_${Date.now()}`;
    const session: ResumableIndexingSession = {
      id: sessionId,
      state: {
        folderId,
        folderPath,
        pendingChanges: [...changes],
        processedPaths: [],
        lastUpdated: new Date(),
        isComplete: false
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Add to active sessions map
    this.activeIndexingSessions.set(sessionId, session);

    // Save the session
    this.saveIndexingSession(session).subscribe();

    return session;
  }

  /**
   * Update an existing indexing session
   * @param sessionId ID of the session to update
   * @param updates Partial state updates
   * @returns Observable of the updated session
   */
  private updateIndexingSession(
    sessionId: string,
    updates: Partial<IndexingState>
  ): Observable<ResumableIndexingSession | null> {
    const session = this.activeIndexingSessions.get(sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      return of(null);
    }

    // Update the session state
    session.state = {
      ...session.state,
      ...updates,
      lastUpdated: new Date()
    };
    session.updatedAt = new Date();

    // Save the updated session
    return this.saveIndexingSession(session).pipe(
      map(success => {
        if (success) {
          return session;
        } else {
          console.error(`Failed to save updated session: ${sessionId}`);
          return null;
        }
      })
    );
  }

  /**
   * Process file changes with support for resuming interrupted operations
   * @param folderId ID of the folder
   * @param folderPath Path of the folder
   * @param changes Array of file changes
   * @param cancellationToken Optional cancellation token to cancel the operation
   * @param sessionId Optional ID of an existing session to resume
   * @returns Observable of the number of processed files
   */
  processFileChangesWithResume(
    folderId: string,
    folderPath: string,
    changes: FileChange[],
    cancellationToken?: CancellationToken,
    sessionId?: string
  ): Observable<number> {
    // Check if operation was cancelled before starting
    if (cancellationToken && cancellationToken.isCancelled) {
      console.log(`Processing of file changes for folder ${folderPath} was cancelled before starting`);
      return of(0);
    }

    // Get or create the session
    let session: ResumableIndexingSession;
    if (sessionId && this.activeIndexingSessions.has(sessionId)) {
      session = this.activeIndexingSessions.get(sessionId)!;
      console.log(`Resuming indexing session: ${sessionId}`);
    } else {
      session = this.createIndexingSession(folderId, folderPath, changes);
      console.log(`Created new indexing session: ${session.id}`);
    }

    // Return an observable that processes each file
    return new Observable(subscriber => {
      let processedCount = session.state.processedPaths.length;
      const pendingChanges = [...session.state.pendingChanges];

      // Group changes by file path
      const changesByPath = this.groupChangesByPath(pendingChanges);

      // Process files one by one
      const processNextFile = (index: number) => {
        // Check if we're done
        if (index >= Object.keys(changesByPath).length) {
          // Mark session as complete
          this.updateIndexingSession(session.id, {
            isComplete: true
          }).subscribe({
            next: () => {
              // Delete the completed session
              this.deleteIndexingSession(session.id).subscribe();
            }
          });

          subscriber.next(processedCount);
          subscriber.complete();
          return;
        }

        // Check if operation was cancelled
        if (cancellationToken && cancellationToken.isCancelled) {
          console.log(`Processing of file changes for folder ${folderPath} was cancelled`);

          // Save the current state for later resumption
          this.updateIndexingSession(session.id, {
            pendingChanges: pendingChanges.filter(change =>
              !session.state.processedPaths.includes(change.path)
            )
          }).subscribe();

          subscriber.next(processedCount);
          subscriber.complete();
          return;
        }

        // Get the file path and changes
        const filePath = Object.keys(changesByPath)[index];

        // Skip if already processed
        if (session.state.processedPaths.includes(filePath)) {
          processNextFile(index + 1);
          return;
        }

        const fileChanges = changesByPath[filePath];

        // Process the file
        this.processFileChange(folderId, folderPath, filePath, fileChanges)
          .pipe(
            // Update the session state after processing each file
            tap(processed => {
              if (processed) {
                processedCount++;
                session.state.processedPaths.push(filePath);

                // Update session every 10 files or every 30 seconds
                if (processedCount % 10 === 0 ||
                    (new Date().getTime() - session.state.lastUpdated.getTime() > 30000)) {
                  this.updateIndexingSession(session.id, {
                    processedPaths: [...session.state.processedPaths]
                  }).subscribe();
                }
              }
            })
          )
          .subscribe({
            next: (processed) => {
              // Process the next file
              processNextFile(index + 1);
            },
            error: (error) => {
              console.error(`Error processing file change for ${filePath}:`, error);

              // Update session with error
              this.updateIndexingSession(session.id, {
                error: `Error processing file: ${filePath}: ${error.message || error}`
              }).subscribe();

              // Process the next file
              processNextFile(index + 1);
            }
          });
      };

      // Start processing files
      processNextFile(0);
    });
  }

  /**
   * Get all resumable indexing sessions
   * @returns Observable of all resumable sessions
   */
  getResumableSessions(): Observable<ResumableIndexingSession[]> {
    return this.loadSavedIndexingSessions().pipe(
      map(sessions => sessions.filter(s => !s.state.isComplete))
    );
  }

  /**
   * Resume an interrupted indexing session
   * @param sessionId ID of the session to resume
   * @param cancellationToken Optional cancellation token to cancel the operation
   * @returns Observable of the number of processed files
   */
  resumeIndexingSession(
    sessionId: string,
    cancellationToken?: CancellationToken
  ): Observable<number> {
    const session = this.activeIndexingSessions.get(sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      return throwError(() => new Error(`Session not found: ${sessionId}`));
    }

    if (session.state.isComplete) {
      console.log(`Session ${sessionId} is already complete`);
      return of(session.state.processedPaths.length);
    }

    return this.processFileChangesWithResume(
      session.state.folderId,
      session.state.folderPath,
      session.state.pendingChanges,
      cancellationToken,
      sessionId
    );
  }
}
