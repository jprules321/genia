import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ElectronWindowService } from './electron-window.service';
import { IndexationErrorType, CancellationToken } from './indexing.service';

/**
 * Service responsible for the actual indexing of files
 * This service is separated from the main IndexingService to improve separation of concerns
 */
@Injectable({
  providedIn: 'root'
})
export class FileIndexingService {
  constructor(
    private electronWindowService: ElectronWindowService
  ) {}

  /**
   * Index a single file
   * @param filePath Path to the file to index
   * @param folderId ID of the folder containing the file
   * @param cancellationToken Optional cancellation token to cancel the operation
   */
  indexFile(filePath: string, folderId: string, cancellationToken?: CancellationToken): Observable<boolean> {
    // Check if operation was cancelled before starting
    if (cancellationToken && cancellationToken.isCancelled) {
      console.log(`Indexation of file ${filePath} was cancelled before starting`);
      return of(false);
    }

    // This would call the Electron main process to read and index the file
    // For now, we'll just return a success result
    return of(true).pipe(
      catchError(error => {
        console.error(`Error indexing file ${filePath}:`, error);
        throw error;
      })
    );
  }

  /**
   * Check if a file is indexable
   * @param filePath Path to the file to check
   */
  isFileIndexable(filePath: string): Observable<boolean> {
    // This would check if the file is of a supported type and not too large
    // For now, we'll just return true
    return of(true);
  }

  /**
   * Get the content type of a file
   * @param filePath Path to the file
   */
  getFileContentType(filePath: string): Observable<string> {
    // This would determine the content type of the file based on its extension and content
    // For now, we'll just return a placeholder
    const extension = filePath.split('.').pop()?.toLowerCase() || '';

    switch (extension) {
      case 'txt':
      case 'md':
      case 'markdown':
        return of('text/plain');
      case 'html':
      case 'htm':
        return of('text/html');
      case 'pdf':
        return of('application/pdf');
      case 'doc':
      case 'docx':
        return of('application/msword');
      case 'xls':
      case 'xlsx':
        return of('application/vnd.ms-excel');
      case 'ppt':
      case 'pptx':
        return of('application/vnd.ms-powerpoint');
      case 'jpg':
      case 'jpeg':
        return of('image/jpeg');
      case 'png':
        return of('image/png');
      case 'gif':
        return of('image/gif');
      default:
        return of('application/octet-stream');
    }
  }

  /**
   * Extract text content from a file
   * @param filePath Path to the file
   * @param contentType Content type of the file
   */
  extractTextContent(filePath: string, contentType: string): Observable<string> {
    // This would extract text content from the file based on its content type
    // For now, we'll just return a placeholder
    return of(`Sample content for ${filePath}`);
  }

  /**
   * Categorize an error based on its type and message
   * @param error The error object
   * @param folderPath Optional folder path associated with the error
   * @param filePath Optional file path associated with the error
   * @returns An object with categorized error information
   */
  categorizeError(error: any, folderPath?: string, filePath?: string): {
    error: string;
    errorType: IndexationErrorType;
    details?: any;
  } {
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
    }

    // Extract additional details if available
    if (error.code) {
      details = { code: error.code };
    }
    if (error.stack) {
      details = { ...details, stack: error.stack };
    }

    return {
      error: errorMessage,
      errorType,
      details
    };
  }
}
