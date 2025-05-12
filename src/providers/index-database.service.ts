import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ElectronWindowService } from './electron-window.service';

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
}

/**
 * Service responsible for database operations related to file indexing
 * This service is separated from the main IndexingService to improve separation of concerns
 */
@Injectable({
  providedIn: 'root'
})
export class IndexDatabaseService {
  constructor(
    private electronWindowService: ElectronWindowService
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
   * Save an indexed file to the database
   * @param file The file to save
   */
  saveIndexedFile(file: IndexedFile): Observable<boolean> {
    // This would call the Electron main process to save the file to the database
    // For now, we'll just return a success result
    return of(true).pipe(
      catchError(error => {
        console.error(`Error saving indexed file ${file.path}:`, error);
        return of(false);
      })
    );
  }

  /**
   * Save multiple indexed files to the database in a batch
   * @param files Array of files to save
   */
  saveIndexedFilesBatch(files: IndexedFile[]): Observable<{ success: boolean, count: number }> {
    // This would call the Electron main process to save the files to the database
    // For now, we'll just return a success result
    return of({ success: true, count: files.length }).pipe(
      catchError(error => {
        console.error(`Error saving batch of ${files.length} indexed files:`, error);
        return of({ success: false, count: 0 });
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
    return from(this.electronWindowService.clearAllIndexedFiles()).pipe(
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
        return of(false);
      })
    );
  }
}
