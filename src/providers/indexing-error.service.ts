import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ElectronWindowService } from './electron-window.service';

/**
 * Enum for indexation error types
 */
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
 * Interface for indexation errors
 */
export interface IndexationError {
  timestamp: Date;
  folderPath: string;
  filePath: string;
  error: string;
  errorType: IndexationErrorType;
  details?: any;
}

/**
 * Service responsible for managing indexation errors
 * This service is separated from the main IndexingService to improve separation of concerns
 */
@Injectable({
  providedIn: 'root'
})
export class IndexingErrorService {
  constructor(
    private electronWindowService: ElectronWindowService
  ) {}

  /**
   * Get all indexation errors
   * @param folderPath Optional folder path to filter errors
   */
  getIndexationErrors(folderPath?: string): Observable<IndexationError[]> {
    return from(this.electronWindowService.getIndexationErrorLog(folderPath)).pipe(
      map(result => {
        if (result.success) {
          return result.errors.map((error: any) => ({
            ...error,
            timestamp: new Date(error.timestamp)
          }));
        } else {
          console.error('Error getting indexation errors:', result.error);
          return [];
        }
      }),
      catchError(error => {
        console.error('Error getting indexation errors:', error);
        return of([]);
      })
    );
  }

  /**
   * Check if a folder has any indexation errors
   * @param folderPath The path of the folder to check
   */
  hasFolderIndexationErrors(folderPath: string): Observable<boolean> {
    return this.getIndexationErrors(folderPath).pipe(
      map(errors => errors.length > 0)
    );
  }

  /**
   * Get the number of indexation errors for a folder
   * @param folderPath The path of the folder to check
   */
  getFolderErrorCount(folderPath: string): Observable<number> {
    return this.getIndexationErrors(folderPath).pipe(
      map(errors => errors.length)
    );
  }

  /**
   * Clear all indexation errors
   * @param folderPath Optional folder path to clear errors for
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
   * Categorize an error based on its type and message
   * @param error The error object
   * @param folderPath Optional folder path associated with the error
   * @param filePath Optional file path associated with the error
   * @returns An object with categorized error information
   */
  categorizeError(error: any, folderPath?: string, filePath?: string): IndexationError {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    let errorType = IndexationErrorType.UNKNOWN;
    let details = null;

    // Categorize based on error message patterns
    if (errorMessage.includes('EACCES') || errorMessage.includes('permission')) {
      errorType = IndexationErrorType.PERMISSION;
    } else if (errorMessage.includes('ENOENT') || errorMessage.includes('no such file') ||
               errorMessage.includes('EISDIR') || errorMessage.includes('ENOTDIR')) {
      errorType = IndexationErrorType.FILE_SYSTEM;
    } else if (errorMessage.includes('network') || errorMessage.includes('connection') ||
               errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
      errorType = IndexationErrorType.NETWORK;
    } else if (errorMessage.includes('database') || errorMessage.includes('SQL') ||
               errorMessage.includes('query')) {
      errorType = IndexationErrorType.DATABASE;
    } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
      errorType = IndexationErrorType.TIMEOUT;
    } else if (errorMessage.includes('cancelled') || errorMessage.includes('canceled')) {
      errorType = IndexationErrorType.CANCELLED;
    }

    // Extract additional details if available
    if (error.code) {
      details = { code: error.code };
    }
    if (error.stack) {
      details = { ...details, stack: error.stack };
    }

    return {
      timestamp: new Date(),
      folderPath: folderPath || 'unknown',
      filePath: filePath || 'unknown',
      error: errorMessage,
      errorType,
      details
    };
  }

  /**
   * Log an indexation error
   * @param error The error object or message
   * @param folderPath The folder path associated with the error
   * @param filePath The file path associated with the error
   */
  logIndexationError(error: any, folderPath: string, filePath: string): Observable<boolean> {
    const categorizedError = this.categorizeError(error, folderPath, filePath);

    // In a real implementation, this would send the error to the Electron main process
    // to be logged in a database or file
    console.error('Indexation error:', categorizedError);

    // For now, we'll just return a success result
    return of(true);
  }
}
