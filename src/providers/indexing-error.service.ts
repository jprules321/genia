import { Injectable } from '@angular/core';
import { Observable, from, of, BehaviorSubject } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
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
  VALIDATION = 'validation',
  RESOURCE = 'resource',
  UNKNOWN = 'unknown'
}

/**
 * Enum for error severity levels
 */
export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
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
  severity?: ErrorSeverity;
  retryable?: boolean;
  details?: any;
  occurrences?: number;
}

/**
 * Interface for error aggregation
 */
export interface ErrorAggregation {
  errorType: IndexationErrorType;
  count: number;
  severity: ErrorSeverity;
  examples: IndexationError[];
}

/**
 * Service responsible for managing indexation errors
 * This service is separated from the main IndexingService to improve separation of concerns
 */
@Injectable({
  providedIn: 'root'
})
export class IndexingErrorService {
  private errorCache: Map<string, IndexationError> = new Map();
  private errorAggregations: Map<string, ErrorAggregation> = new Map();
  private errorSubject = new BehaviorSubject<ErrorAggregation[]>([]);

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
   * Get aggregated errors
   * @returns Observable of error aggregations
   */
  getAggregatedErrors(): Observable<ErrorAggregation[]> {
    return this.errorSubject.asObservable();
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
    // Clear local cache if folderPath is provided
    if (folderPath) {
      this.errorCache.forEach((error, key) => {
        if (error.folderPath === folderPath) {
          this.errorCache.delete(key);
        }
      });
    } else {
      this.errorCache.clear();
    }

    // Clear aggregations and update subject
    this.errorAggregations.clear();
    this.errorSubject.next([]);

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
    let severity = ErrorSeverity.ERROR;
    let retryable = false;
    let details = null;

    // Categorize based on error message patterns
    if (errorMessage.includes('EACCES') || errorMessage.includes('permission')) {
      errorType = IndexationErrorType.PERMISSION;
      severity = ErrorSeverity.ERROR;
      retryable = false;
    } else if (errorMessage.includes('ENOENT') || errorMessage.includes('no such file') ||
               errorMessage.includes('EISDIR') || errorMessage.includes('ENOTDIR')) {
      errorType = IndexationErrorType.FILE_SYSTEM;
      severity = ErrorSeverity.ERROR;
      retryable = false;
    } else if (errorMessage.includes('network') || errorMessage.includes('connection') ||
               errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ECONNRESET')) {
      errorType = IndexationErrorType.NETWORK;
      severity = ErrorSeverity.WARNING;
      retryable = true;
    } else if (errorMessage.includes('database') || errorMessage.includes('SQL') ||
               errorMessage.includes('query') || errorMessage.includes('SQLITE')) {
      errorType = IndexationErrorType.DATABASE;
      severity = ErrorSeverity.ERROR;
      retryable = true;
    } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out') ||
               errorMessage.includes('ETIMEDOUT')) {
      errorType = IndexationErrorType.TIMEOUT;
      severity = ErrorSeverity.WARNING;
      retryable = true;
    } else if (errorMessage.includes('cancelled') || errorMessage.includes('canceled') ||
               errorMessage.includes('abort')) {
      errorType = IndexationErrorType.CANCELLED;
      severity = ErrorSeverity.INFO;
      retryable = false;
    } else if (errorMessage.includes('validation') || errorMessage.includes('invalid') ||
               errorMessage.includes('format')) {
      errorType = IndexationErrorType.VALIDATION;
      severity = ErrorSeverity.WARNING;
      retryable = false;
    } else if (errorMessage.includes('memory') || errorMessage.includes('disk space') ||
               errorMessage.includes('ENOMEM') || errorMessage.includes('ENOSPC')) {
      errorType = IndexationErrorType.RESOURCE;
      severity = ErrorSeverity.CRITICAL;
      retryable = false;
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
      severity,
      retryable,
      details,
      occurrences: 1
    };
  }

  /**
   * Generate a unique key for an error to use in aggregation
   * @param error The error to generate a key for
   * @returns A string key
   */
  private getErrorKey(error: IndexationError): string {
    return `${error.errorType}:${error.folderPath}:${error.error.substring(0, 50)}`;
  }

  /**
   * Update error aggregations based on the current error cache
   */
  private updateAggregations(): void {
    this.errorAggregations.clear();

    // Group errors by type
    this.errorCache.forEach(error => {
      const typeKey = error.errorType;

      if (!this.errorAggregations.has(typeKey)) {
        this.errorAggregations.set(typeKey, {
          errorType: error.errorType,
          count: 0,
          severity: error.severity || ErrorSeverity.ERROR,
          examples: []
        });
      }

      const aggregation = this.errorAggregations.get(typeKey)!;
      aggregation.count += error.occurrences || 1;

      // Keep the most severe error level
      if ((error.severity === ErrorSeverity.CRITICAL) ||
          (error.severity === ErrorSeverity.ERROR && aggregation.severity !== ErrorSeverity.CRITICAL) ||
          (error.severity === ErrorSeverity.WARNING && aggregation.severity !== ErrorSeverity.CRITICAL && aggregation.severity !== ErrorSeverity.ERROR)) {
        aggregation.severity = error.severity;
      }

      // Keep up to 5 examples
      if (aggregation.examples.length < 5) {
        aggregation.examples.push(error);
      }
    });

    // Notify subscribers
    this.errorSubject.next(Array.from(this.errorAggregations.values()));
  }

  /**
   * Log an indexation error
   * @param error The error object or message
   * @param folderPath The folder path associated with the error
   * @param filePath The file path associated with the error
   */
  logIndexationError(error: any, folderPath: string, filePath: string): Observable<boolean> {
    const categorizedError = this.categorizeError(error, folderPath, filePath);
    const errorKey = this.getErrorKey(categorizedError);

    // Check if we already have this error
    if (this.errorCache.has(errorKey)) {
      const existingError = this.errorCache.get(errorKey)!;
      existingError.occurrences = (existingError.occurrences || 1) + 1;
      existingError.timestamp = new Date(); // Update timestamp to most recent occurrence
    } else {
      this.errorCache.set(errorKey, categorizedError);
    }

    // Update aggregations
    this.updateAggregations();

    // Send to Electron main process
    return from(this.electronWindowService.logIndexationError(categorizedError)).pipe(
      map(result => result.success),
      catchError(err => {
        console.error('Error logging indexation error:', err);
        return of(false);
      })
    );
  }

  /**
   * Get user-friendly error message based on error type and severity
   * @param error The error to get a message for
   * @returns A user-friendly error message
   */
  getUserFriendlyErrorMessage(error: IndexationError): string {
    switch (error.errorType) {
      case IndexationErrorType.PERMISSION:
        return `Permission denied: Cannot access "${error.filePath}". Please check file permissions.`;
      case IndexationErrorType.FILE_SYSTEM:
        return `File system error: "${error.filePath}" could not be accessed or does not exist.`;
      case IndexationErrorType.NETWORK:
        return `Network error: Connection issue while processing "${error.filePath}". Please check your network connection.`;
      case IndexationErrorType.DATABASE:
        return `Database error: Could not save or retrieve data for "${error.filePath}". The database may be corrupted.`;
      case IndexationErrorType.TIMEOUT:
        return `Timeout: Operation took too long while processing "${error.filePath}". Try again later.`;
      case IndexationErrorType.CANCELLED:
        return `Operation cancelled: Processing of "${error.filePath}" was cancelled.`;
      case IndexationErrorType.VALIDATION:
        return `Validation error: "${error.filePath}" contains invalid data or format.`;
      case IndexationErrorType.RESOURCE:
        return `Resource error: Not enough system resources to process "${error.filePath}". Free up disk space or memory.`;
      default:
        return `Unknown error while processing "${error.filePath}": ${error.error}`;
    }
  }
}
