import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ElectronWindowService } from './electron-window.service';
import { Folder } from '../components/folders/folders.component';
import { CancellationToken } from './indexing.service';

/**
 * Service responsible for IPC communication with Electron related to indexing
 * This service is separated from the main IndexingService to improve separation of concerns
 */
@Injectable({
  providedIn: 'root'
})
export class IndexingIPCService {
  constructor(
    private electronWindowService: ElectronWindowService
  ) {}

  /**
   * Send folder ID response back to main process
   * @param response Response data
   */
  sendFolderIdResponse(response: any): Promise<void> {
    return this.electronWindowService.sendFolderIdResponse(response).catch(error => {
      console.error('Error sending folder ID response:', error);
    });
  }

  /**
   * Send indexed files response back to main process
   * @param response Response data
   */
  sendIndexedFilesResponse(response: any): Promise<void> {
    return this.electronWindowService.sendIndexedFilesResponse(response).catch(error => {
      console.error('Error sending indexed files response:', error);
    });
  }

  /**
   * Invoke indexing of a folder
   * @param folder The folder to index
   * @param cancellationToken Optional cancellation token
   */
  invokeIndexFolder(folder: Folder, cancellationToken?: CancellationToken): Promise<any> {
    console.log(`Indexing folder: ${folder.name} (${folder.path})`);

    // Pass cancellation information to the main process
    return this.electronWindowService.indexFolder(folder.path, {
      canBeCancelled: true
    }).catch(error => {
      console.error(`Error indexing folder ${folder.name}:`, error);
      throw error;
    });
  }

  /**
   * Invoke indexing of all folders
   * @param folders Array of folders to index
   * @param cancellationToken Optional cancellation token
   */
  invokeIndexAllFolders(folders: Folder[], cancellationToken?: CancellationToken): Promise<any> {
    console.log('Indexing all folders');

    // Extract folder information for the main process
    const folderInfo = folders.map(folder => ({
      id: folder.id,
      path: folder.path,
      name: folder.name
    }));

    // Pass cancellation information to the main process
    return this.electronWindowService.indexAllFolders(folderInfo, {
      canBeCancelled: true
    }).catch(error => {
      console.error('Error indexing all folders:', error);
      throw error;
    });
  }

  /**
   * Stop folder indexation
   * @param folderPath Path of the folder to stop indexing
   */
  stopFolderIndexation(folderPath: string): Observable<boolean> {
    return from(this.electronWindowService.stopFolderIndexation(folderPath)).pipe(
      map(result => result.success),
      catchError(error => {
        console.error(`Error stopping indexation for folder ${folderPath}:`, error);
        return of(false);
      })
    );
  }

  /**
   * Get the database path
   */
  getDatabasePath(): Observable<{ path: string, dir: string }> {
    return from(this.electronWindowService.getDatabasePath()).pipe(
      map(result => {
        if (result.success) {
          return {
            path: result.dbPath,
            dir: result.dbDir
          };
        } else {
          throw new Error(result.error || 'Failed to get database path');
        }
      }),
      catchError(error => {
        console.error('Error getting database path:', error);
        throw error;
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
   * Remove a folder from the index
   * @param folderPath Path of the folder to remove
   */
  removeFolderFromIndex(folderPath: string): Observable<boolean> {
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
   * Clear all indexed files
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
