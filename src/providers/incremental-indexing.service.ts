import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { FileSystemService } from './file-system.service';
import { IndexDatabaseService, IndexedFile } from './index-database.service';
import { ContentTypeService } from './content-type.service';
import { CancellationToken } from './indexing.service';

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
 * Service responsible for incremental indexing of files
 * This service is used to improve performance by only indexing changed portions of files
 */
@Injectable({
  providedIn: 'root'
})
export class IncrementalIndexingService {
  constructor(
    private fileSystemService: FileSystemService,
    private indexDatabaseService: IndexDatabaseService,
    private contentTypeService: ContentTypeService
  ) {}

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
   * Calculate the diff between two strings
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

    // Simple diff algorithm (not optimal but works for demonstration)
    // In a real implementation, you would use a proper diff algorithm

    // Find removed and changed lines
    for (let i = 0; i < oldLines.length; i++) {
      if (i >= newLines.length) {
        // Line was removed
        removedLines.push(i);
      } else if (oldLines[i] !== newLines[i]) {
        // Line was changed
        changedLines.push(i);
      }
    }

    // Find added lines
    for (let i = oldLines.length; i < newLines.length; i++) {
      addedLines.push(i);
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
}
