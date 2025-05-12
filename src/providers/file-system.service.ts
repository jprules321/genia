import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ElectronWindowService } from './electron-window.service';

/**
 * Service responsible for file system operations related to indexing
 * This service is separated from the main IndexingService to improve separation of concerns
 */
@Injectable({
  providedIn: 'root'
})
export class FileSystemService {
  constructor(
    private electronWindowService: ElectronWindowService
  ) {}

  /**
   * Check if a folder is indexable
   * @param folderPath Path of the folder to check
   */
  isFolderIndexable(folderPath: string): Observable<{ indexable: boolean, reason?: string }> {
    return from(this.electronWindowService.checkFolderIndexable(folderPath)).pipe(
      map(result => {
        if (result.success) {
          return {
            indexable: result.indexable,
            reason: result.reason
          };
        } else {
          console.error(`Error checking if folder ${folderPath} is indexable:`, result.error);
          return {
            indexable: false,
            reason: result.error || 'Unknown error'
          };
        }
      }),
      catchError(error => {
        console.error(`Error checking if folder ${folderPath} is indexable:`, error);
        return of({
          indexable: false,
          reason: error.toString()
        });
      })
    );
  }

  /**
   * Get all files in a folder
   * @param folderPath Path of the folder
   * @param recursive Whether to include files in subfolders
   */
  getFilesInFolder(folderPath: string, recursive: boolean = true): Observable<string[]> {
    // This would call the Electron main process to get all files in the folder
    // For now, we'll just return an empty array
    return of([]).pipe(
      catchError(error => {
        console.error(`Error getting files in folder ${folderPath}:`, error);
        return of([]);
      })
    );
  }

  /**
   * Get file stats (size, modification time, etc.)
   * @param filePath Path of the file
   */
  getFileStats(filePath: string): Observable<{
    size: number,
    lastModified: Date,
    isDirectory: boolean,
    isFile: boolean
  }> {
    // This would call the Electron main process to get file stats
    // For now, we'll just return a placeholder
    return of({
      size: 0,
      lastModified: new Date(),
      isDirectory: false,
      isFile: true
    }).pipe(
      catchError(error => {
        console.error(`Error getting stats for file ${filePath}:`, error);
        throw error;
      })
    );
  }

  /**
   * Read a file's content
   * @param filePath Path of the file
   */
  readFileContent(filePath: string): Observable<string> {
    // This would call the Electron main process to read the file
    // For now, we'll just return a placeholder
    return of(`Sample content for ${filePath}`).pipe(
      catchError(error => {
        console.error(`Error reading file ${filePath}:`, error);
        throw error;
      })
    );
  }

  /**
   * Watch a folder for changes
   * @param folderPath Path of the folder to watch
   */
  watchFolder(folderPath: string): Observable<{
    type: 'add' | 'change' | 'unlink',
    path: string
  }> {
    // This would call the Electron main process to watch the folder
    // For now, we'll just return an empty observable
    return new Observable(subscriber => {
      console.log(`Started watching folder: ${folderPath}`);

      // Return a cleanup function
      return () => {
        console.log(`Stopped watching folder: ${folderPath}`);
      };
    });
  }

  /**
   * Start watching multiple folders
   * @param folderPaths Array of folder paths to watch
   */
  startWatchingFolders(folderPaths: string[]): Observable<boolean> {
    return from(this.electronWindowService.startWatchingFolders(folderPaths)).pipe(
      map(result => {
        if (result.success) {
          console.log(`Started watching ${folderPaths.length} folders`);
          return true;
        } else {
          console.error('Error starting folder watching:', result.error);
          return false;
        }
      }),
      catchError(error => {
        console.error('Error starting folder watching:', error);
        return of(false);
      })
    );
  }

  /**
   * Stop watching all folders
   */
  stopWatchingFolders(): Observable<boolean> {
    return from(this.electronWindowService.stopWatchingFolders()).pipe(
      map(result => {
        if (result.success) {
          console.log('Stopped watching all folders');
          return true;
        } else {
          console.error('Error stopping folder watching:', result.error);
          return false;
        }
      }),
      catchError(error => {
        console.error('Error stopping folder watching:', error);
        return of(false);
      })
    );
  }

  /**
   * Open a folder in the system file explorer
   * @param folderPath Path of the folder to open
   */
  openFolder(folderPath: string): Observable<boolean> {
    return from(this.electronWindowService.openDirectory(folderPath)).pipe(
      map(result => {
        if (result.success) {
          console.log(`Opened folder: ${folderPath}`);
          return true;
        } else {
          console.error(`Error opening folder ${folderPath}:`, result.error);
          return false;
        }
      }),
      catchError(error => {
        console.error(`Error opening folder ${folderPath}:`, error);
        return of(false);
      })
    );
  }
}
