import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ElectronWindowService } from './electron-window.service';
import { Folder } from '../components/folders/folders.component';

/**
 * Service responsible for watching folders for changes
 * This service is separated from the main IndexingService to improve separation of concerns
 */
@Injectable({
  providedIn: 'root'
})
export class FolderWatchingService {
  constructor(
    private electronWindowService: ElectronWindowService
  ) {}

  /**
   * Start watching folders for changes
   * @param folders Array of folders to watch
   */
  startWatchingFolders(folders: Folder[]): Observable<boolean> {
    if (!folders || folders.length === 0) {
      console.log('No folders to watch');
      return of(true);
    }

    // Extract folder paths for watching
    const folderPaths = folders.map(folder => ({
      id: folder.id,
      path: folder.path
    }));

    return from(this.electronWindowService.startWatchingFolders(folderPaths)).pipe(
      map(result => {
        if (result.success) {
          console.log('Started watching folders:', folderPaths.map(f => f.path).join(', '));
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
   * Stop watching a specific folder
   * @param folderPath Path of the folder to stop watching
   */
  stopWatchingFolder(folderPath: string): Observable<boolean> {
    return from(this.electronWindowService.stopWatchingFolder(folderPath)).pipe(
      map(result => {
        if (result.success) {
          console.log(`Stopped watching folder: ${folderPath}`);
          return true;
        } else {
          console.error(`Error stopping watching for folder ${folderPath}:`, result.error);
          return false;
        }
      }),
      catchError(error => {
        console.error(`Error stopping watching for folder ${folderPath}:`, error);
        return of(false);
      })
    );
  }

  /**
   * Check if a folder is being watched
   * @param folderPath Path of the folder to check
   */
  isFolderWatched(folderPath: string): Observable<boolean> {
    return from(this.electronWindowService.isFolderWatched(folderPath)).pipe(
      map(result => {
        if (result.success) {
          return result.isWatched || false;
        } else {
          console.error(`Error checking if folder ${folderPath} is watched:`, result.error);
          return false;
        }
      }),
      catchError(error => {
        console.error(`Error checking if folder ${folderPath} is watched:`, error);
        return of(false);
      })
    );
  }

  /**
   * Get all watched folders
   */
  getWatchedFolders(): Observable<string[]> {
    return from(this.electronWindowService.getWatchedFolders()).pipe(
      map(result => {
        if (result.success) {
          return result.folders || [];
        } else {
          console.error('Error getting watched folders:', result.error);
          return [];
        }
      }),
      catchError(error => {
        console.error('Error getting watched folders:', error);
        return of([]);
      })
    );
  }
}
