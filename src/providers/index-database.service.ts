import { Injectable } from '@angular/core';
import { Observable, from, of, throwError, timer } from 'rxjs';
import { map, catchError, tap, retry, mergeMap, retryWhen, concatMap, delayWhen } from 'rxjs/operators';
import { ElectronWindowService } from './electron-window.service';
import { IndexingErrorService, IndexationErrorType } from './indexing-error.service';
import { IndexingSettingsService } from './indexing-settings.service';
import { v4 as uuidv4 } from 'uuid';

/**
 * Interface for indexed file data
 */
export interface IndexedFile {
  id: string;
  folderId: string;
  path: string;
  filename: string;
  content: string;
  embedding?: any; // This would be the vector embedding
  lastIndexed: Date;
  lastModified: Date;
  checksum?: string; // MD5 or other hash for file verification
  fileSize?: number; // Size in bytes
  contentType?: string; // MIME type
  indexingDuration?: number; // Time taken to index in milliseconds
}

/**
 * Interface for database statistics
 */
export interface DatabaseStats {
  totalFiles: number;
  totalFolders: number;
  totalSize: number; // Size in bytes
  lastUpdated: Date;
  integrityStatus: 'ok' | 'warning' | 'error';
  issues?: Array<{
    type: string;
    message: string;
    count: number;
  }>;
}

/**
 * Service responsible for database operations related to file indexing
 * This service is separated from the main IndexingService to improve separation of concerns
 */
@Injectable({
  providedIn: 'root'
})
export class IndexDatabaseService {
  // Use settings from IndexingSettingsService instead of hardcoded values

  constructor(
    private electronWindowService: ElectronWindowService,
    private errorService: IndexingErrorService,
    private indexingSettingsService: IndexingSettingsService
  ) {}

  /**
   * Get all indexed files
   * This method communicates with the Electron main process to query the SQLite database
   */
  getAllIndexedFiles(): Observable<IndexedFile[]> {
    return from(this.electronWindowService.getDatabasePath()).pipe(
      map(result => {
        if (result.success) {
          console.log('Database path:', result.path);
          // In a real implementation, we would query the database
          // For now, we'll just return an empty array
          return [];
        } else {
          console.error('Error getting database path:', result.error);
          return [];
        }
      }),
      catchError(error => {
        console.error('Error getting indexed files:', error);
        return of([]);
      })
    );
  }

  /**
   * Get indexed files for a specific folder
   * @param folderId ID of the folder
   * @param folderPath Path of the folder
   */
  getIndexedFilesForFolder(folderId: string, folderPath: string): Observable<IndexedFile[]> {
    return from(this.electronWindowService.getIndexedFilesForFolder(folderPath)).pipe(
      map(result => {
        if (result.success) {
          // Convert the result to IndexedFile objects
          return (result.files || []).map((file: any) => ({
            id: file.id,
            folderId: file.folderId,
            path: file.path,
            filename: file.filename,
            content: file.content,
            lastIndexed: new Date(file.lastIndexed),
            lastModified: new Date(file.lastModified)
          }));
        } else {
          console.error(`Error getting indexed files for folder ${folderPath}:`, result.error);
          return [];
        }
      }),
      catchError(error => {
        console.error(`Error getting indexed files for folder ${folderPath}:`, error);
        return of([]);
      })
    );
  }

  /**
   * Verify a file's integrity by comparing checksums
   * @param file The file to verify
   * @param actualChecksum The actual checksum of the file
   * @returns True if the file is valid, false otherwise
   */
  private verifyFileIntegrity(file: IndexedFile, actualChecksum?: string): boolean {
    // If no checksum is provided or the file doesn't have a checksum, we can't verify
    if (!file.checksum || !actualChecksum) {
      return true;
    }

    return file.checksum === actualChecksum;
  }

  /**
   * Generate a unique ID for a file
   * @param folderId The folder ID
   * @param filePath The file path
   * @returns A unique ID
   */
  generateFileId(folderId: string, filePath: string): string {
    // Use UUID v4 for truly unique IDs
    return uuidv4();
  }

  /**
   * Save an indexed file to the database with retry logic and transaction support
   * @param file The file to save
   * @param verifyAfterSave Whether to verify the file after saving
   */
  saveIndexedFile(file: IndexedFile, verifyAfterSave: boolean = true): Observable<boolean> {
    // Ensure the file has an ID
    if (!file.id) {
      file.id = this.generateFileId(file.folderId, file.path);
    }

    // Add timestamp if not present
    if (!file.lastIndexed) {
      file.lastIndexed = new Date();
    }

    // Get settings for retry logic
    const settings = this.indexingSettingsService.getSettings();

    return from(this.electronWindowService.saveIndexedFile(file)).pipe(
      retry({
        count: settings.maxRetries,
        delay: settings.retryDelayMs
      }),
      mergeMap(result => {
        if (!result.success) {
          // Log the error
          this.errorService.logIndexationError(
            new Error(`Failed to save file: ${result.error}`),
            file.folderId,
            file.path
          );
          return of(false);
        }

        // If verification is requested, verify the file was saved correctly
        if (verifyAfterSave) {
          return this.verifyFileSaved(file.id, file.folderId);
        }

        return of(true);
      }),
      catchError(error => {
        // Log the error
        this.errorService.logIndexationError(error, file.folderId, file.path);
        console.error(`Error saving indexed file ${file.path}:`, error);
        return of(false);
      })
    );
  }

  /**
   * Verify that a file was saved correctly
   * @param fileId The ID of the file to verify
   * @param folderId The ID of the folder containing the file
   */
  private verifyFileSaved(fileId: string, folderId: string): Observable<boolean> {
    return from(this.electronWindowService.verifyFileSaved(fileId, folderId)).pipe(
      map(result => {
        if (!result.success) {
          console.error(`Verification failed for file ${fileId}:`, result.error);
          return false;
        }
        return result.exists;
      }),
      catchError(error => {
        console.error(`Error verifying file ${fileId}:`, error);
        return of(false);
      })
    );
  }

  /**
   * Save multiple indexed files to the database in a batch with transaction support
   * and dynamic batch sizing based on folder characteristics
   * @param files Array of files to save
   * @param verifyAfterSave Whether to verify the files after saving
   * @param isSmallFolder Whether this is a small folder (for optimized processing)
   */
  saveIndexedFilesBatch(
    files: IndexedFile[],
    verifyAfterSave: boolean = true,
    isSmallFolder: boolean = false
  ): Observable<{ success: boolean, count: number, errors?: any[] }> {
    if (!files || files.length === 0) {
      return of({ success: true, count: 0 });
    }

    // Get settings for batch sizes
    const settings = this.indexingSettingsService.getSettings();

    // Determine appropriate batch size based on folder size
    let batchSize: number;
    if (isSmallFolder) {
      // Special handling for small folders - use smaller batch size for faster feedback
      batchSize = settings.smallFolderBatchSize;
    } else {
      // Dynamic batch size based on total number of files
      batchSize = this.indexingSettingsService.getBatchSizeForFolder(files.length);
    }

    console.log(`Using batch size ${batchSize} for ${files.length} files (small folder: ${isSmallFolder})`);

    // Ensure all files have IDs and timestamps
    files = files.map(file => ({
      ...file,
      id: file.id || this.generateFileId(file.folderId, file.path),
      lastIndexed: file.lastIndexed || new Date()
    }));

    // Process files in batches to prevent memory issues
    const batches: IndexedFile[][] = [];
    for (let i = 0; i < files.length; i += batchSize) {
      batches.push(files.slice(i, i + batchSize));
    }

    // Process each batch sequentially
    let processedCount = 0;
    let successCount = 0;
    let errors: any[] = [];

    // Track start time for performance monitoring
    const startTime = Date.now();

    // For small folders, we'll use a more aggressive approach with fewer retries
    // but faster processing to provide immediate feedback
    const maxRetries = isSmallFolder ? 1 : settings.maxRetries;
    const retryDelay = isSmallFolder ? 500 : settings.retryDelayMs;

    // Process batches sequentially
    const processBatch = (batchIndex: number): Observable<{ success: boolean, count: number, errors?: any[], performance?: any }> => {
      if (batchIndex >= batches.length) {
        const endTime = Date.now();
        const totalTime = endTime - startTime;
        const averageTimePerFile = files.length > 0 ? totalTime / files.length : 0;

        return of({
          success: successCount > 0,
          count: successCount,
          errors: errors.length > 0 ? errors : undefined,
          performance: {
            totalTimeMs: totalTime,
            averageTimePerFileMs: averageTimePerFile,
            filesPerSecond: totalTime > 0 ? (successCount * 1000 / totalTime) : 0
          }
        });
      }

      const batch = batches[batchIndex];

      // For transaction support, we'll use a specific transaction-based API
      return from(this.electronWindowService.saveIndexedFilesBatchWithTransaction(batch)).pipe(
        // Use retryWhen for more sophisticated retry logic with exponential backoff
        retryWhen(errors =>
          errors.pipe(
            // Log the error
            tap(error => console.error(`Error saving batch ${batchIndex}, retrying:`, error)),
            // Retry with delay
            concatMap((error, i) => {
              const retryAttempt = i + 1;
              // Max retries from settings
              if (retryAttempt > maxRetries) {
                return throwError(error);
              }
              // Exponential backoff
              const delay = retryAttempt * retryDelay;
              console.log(`Retrying batch ${batchIndex} after ${delay}ms (attempt ${retryAttempt}/${maxRetries})`);
              return timer(delay);
            })
          )
        ),
        mergeMap(result => {
          processedCount += batch.length;

          if (!result.success) {
            // Log errors for each file in the batch
            batch.forEach(file => {
              this.errorService.logIndexationError(
                new Error(`Failed to save file in batch: ${result.error}`),
                file.folderId,
                file.path
              );
            });

            errors.push({
              batchIndex,
              error: result.error,
              files: batch.map(f => f.path)
            });

            // Continue with the next batch even if this one failed
            return processBatch(batchIndex + 1);
          }

          successCount += result.count || 0;

          // If verification is requested, verify the files were saved correctly
          if (verifyAfterSave) {
            return this.verifyBatchSaved(batch).pipe(
              mergeMap(verificationResult => {
                if (!verificationResult.success) {
                  errors.push({
                    batchIndex,
                    error: 'Verification failed',
                    files: verificationResult.failedFiles
                  });
                }

                // Continue with the next batch
                return processBatch(batchIndex + 1);
              })
            );
          }

          // Continue with the next batch
          return processBatch(batchIndex + 1);
        }),
        catchError(error => {
          console.error(`Error processing batch ${batchIndex}:`, error);

          // Log errors for each file in the batch
          batch.forEach(file => {
            this.errorService.logIndexationError(error, file.folderId, file.path);
          });

          errors.push({
            batchIndex,
            error: error.message,
            files: batch.map(f => f.path)
          });

          // Continue with the next batch even if this one failed
          return processBatch(batchIndex + 1);
        })
      );
    };

    // Start processing with the first batch
    return processBatch(0);
  }

  /**
   * Determine if a folder should be treated as a small folder for optimized processing
   * @param fileCount Number of files in the folder
   */
  isSmallFolder(fileCount: number): boolean {
    return fileCount < 100;
  }

  /**
   * Verify that a batch of files was saved correctly
   * @param files The files to verify
   */
  private verifyBatchSaved(files: IndexedFile[]): Observable<{ success: boolean, failedFiles?: string[] }> {
    const fileIds = files.map(f => ({ id: f.id, folderId: f.folderId, path: f.path }));

    return from(this.electronWindowService.verifyFilesBatchSaved(fileIds)).pipe(
      map(result => {
        if (!result.success) {
          console.error('Batch verification failed:', result.error);
          return {
            success: false,
            failedFiles: files.map(f => f.path)
          };
        }

        const failedFiles = result.results
          .filter(r => !r.exists)
          .map(r => files.find(f => f.id === r.id)?.path || 'unknown');

        return {
          success: failedFiles.length === 0,
          failedFiles: failedFiles.length > 0 ? failedFiles : undefined
        };
      }),
      catchError(error => {
        console.error('Error verifying batch:', error);
        return of({
          success: false,
          failedFiles: files.map(f => f.path)
        });
      })
    );
  }

  /**
   * Remove a file from the index
   * @param filePath Path of the file to remove
   * @param folderId ID of the folder containing the file
   */
  removeFileFromIndex(filePath: string, folderId: string): Observable<boolean> {
    return from(this.electronWindowService.removeFileFromIndex(filePath, folderId)).pipe(
      map(result => {
        if (result.success) {
          console.log(`File removed from index: ${filePath}`);
          return true;
        } else {
          console.error(`Error removing file from index: ${filePath}`, result.error);
          return false;
        }
      }),
      catchError(error => {
        console.error(`Error removing file from index: ${filePath}`, error);
        return of(false);
      })
    );
  }

  /**
   * Remove all files for a specific folder from the index
   * @param folderId ID of the folder
   * @param folderPath Path of the folder
   */
  removeFolderFromIndex(folderId: string, folderPath: string): Observable<boolean> {
    return from(this.electronWindowService.removeFolderFromIndex(folderPath)).pipe(
      map(result => {
        if (result.success) {
          console.log(`Folder removed from index: ${folderPath}`);
          return true;
        } else {
          console.error(`Error removing folder from index: ${folderPath}`, result.error);
          return false;
        }
      }),
      catchError(error => {
        console.error(`Error removing folder from index: ${folderPath}`, error);
        return of(false);
      })
    );
  }

  /**
   * Clear all indexed files from the database
   */
  clearAllIndexedFiles(): Observable<boolean> {
    // Get settings for retry logic
    const settings = this.indexingSettingsService.getSettings();

    return from(this.electronWindowService.clearAllIndexedFiles()).pipe(
      retry({
        count: settings.maxRetries,
        delay: settings.retryDelayMs
      }),
      map(result => {
        if (result.success) {
          console.log('All indexed files cleared');
          return true;
        } else {
          console.error('Error clearing all indexed files:', result.error);
          return false;
        }
      }),
      catchError(error => {
        console.error('Error clearing all indexed files:', error);
        this.errorService.logIndexationError(
          error,
          'all',
          'database'
        );
        return of(false);
      })
    );
  }

  /**
   * Get database statistics
   * @returns Observable of database statistics
   */
  getDatabaseStats(): Observable<DatabaseStats> {
    // @ts-ignore
    return from(this.electronWindowService.getDatabaseStats()).pipe(
      map(result => {
        if (!result.success) {
          console.error('Error getting database stats:', result.error);
          throw new Error(`Failed to get database stats: ${result.error}`);
        }

        return {
          totalFiles: result.stats.totalFiles || 0,
          totalFolders: result.stats.totalFolders || 0,
          totalSize: result.stats.totalSize || 0,
          lastUpdated: new Date(result.stats.lastUpdated),
          integrityStatus: (result.stats.integrityStatus === 'warning' || result.stats.integrityStatus === 'error') ? result.stats.integrityStatus : 'ok',
          issues: result.stats.issues
        };
      }),
      catchError(error => {
        console.error('Error getting database stats:', error);
        this.errorService.logIndexationError(
          error,
          'all',
          'database'
        );

        // Return default stats with error status
        return of({
          totalFiles: 0,
          totalFolders: 0,
          totalSize: 0,
          lastUpdated: new Date(),
          integrityStatus: 'error',
          issues: [{
            type: 'error',
            message: `Failed to get database stats: ${error.message}`,
            count: 1
          }]
        });
      })
    );
  }

  /**
   * Run database integrity check
   * @param thorough Whether to run a thorough check (slower but more comprehensive)
   * @returns Observable of check results
   */
  checkDatabaseIntegrity(thorough: boolean = false): Observable<{
    success: boolean,
    issues?: Array<{ type: string, message: string, count: number }>
  }> {
    return from(this.electronWindowService.checkDatabaseIntegrity(thorough)).pipe(
      map(result => {
        if (!result.success) {
          console.error('Error checking database integrity:', result.error);
          throw new Error(`Failed to check database integrity: ${result.error}`);
        }

        return {
          success: result.integrity,
          issues: result.issues
        };
      }),
      catchError(error => {
        console.error('Error checking database integrity:', error);
        this.errorService.logIndexationError(
          error,
          'all',
          'database'
        );

        return of({
          success: false,
          issues: [{
            type: 'error',
            message: `Failed to check database integrity: ${error.message}`,
            count: 1
          }]
        });
      })
    );
  }

  /**
   * Repair database issues
   * @returns Observable of repair results
   */
  repairDatabase(): Observable<{
    success: boolean,
    repairedIssues?: number,
    remainingIssues?: number
  }> {
    return from(this.electronWindowService.repairDatabase()).pipe(
      map(result => {
        if (!result.success) {
          console.error('Error repairing database:', result.error);
          throw new Error(`Failed to repair database: ${result.error}`);
        }

        return {
          success: result.repaired,
          repairedIssues: result.repairedIssues,
          remainingIssues: result.remainingIssues
        };
      }),
      catchError(error => {
        console.error('Error repairing database:', error);
        this.errorService.logIndexationError(
          error,
          'all',
          'database'
        );

        return of({
          success: false
        });
      })
    );
  }

  /**
   * Optimize database (vacuum, reindex, etc.)
   * @returns Observable of optimization results
   */
  optimizeDatabase(): Observable<boolean> {
    return from(this.electronWindowService.optimizeDatabase()).pipe(
      map(result => {
        if (!result.success) {
          console.error('Error optimizing database:', result.error);
          throw new Error(`Failed to optimize database: ${result.error}`);
        }

        return true;
      }),
      catchError(error => {
        console.error('Error optimizing database:', error);
        this.errorService.logIndexationError(
          error,
          'all',
          'database'
        );

        return of(false);
      })
    );
  }
}
