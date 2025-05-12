import { Injectable } from '@angular/core';
import { Observable, of, from } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { Folder } from '../components/folders/folders.component';
import { ElectronWindowService } from './electron-window.service';

@Injectable({
  providedIn: 'root'
})
export class FoldersService {
  private readonly STORAGE_KEY = 'genia_folders';

  constructor(private electronWindowService: ElectronWindowService) { }

  /**
   * Get all folders from local storage
   */
  getFolders(): Observable<Folder[]> {
    try {
      const foldersJson = localStorage.getItem(this.STORAGE_KEY);
      const folders = foldersJson ? JSON.parse(foldersJson) : [];
      console.log(folders);

      // Convert date strings to Date objects
      const foldersWithDates = folders.map(folder => ({
        ...folder,
        createdAt: folder.createdAt ? new Date(folder.createdAt) : new Date()
      }));

      return of(foldersWithDates);
    } catch (error) {
      console.error('Error getting folders:', error);
      return of([]);
    }
  }

  /**
   * Add a new folder to local storage
   */
  addFolder(folder: Folder): Observable<Folder> {
    return this.getFolders().pipe(
      map(folders => {
        // Generate ID if not provided
        if (!folder.id) {
          folder.id = Date.now().toString();
        }

        // Set creation date if not provided
        if (!folder.createdAt) {
          folder.createdAt = new Date();
        }

        // Ensure createdAt is a Date object
        const folderWithDate = {
          ...folder,
          createdAt: folder.createdAt instanceof Date ? folder.createdAt : new Date(folder.createdAt)
        };

        const updatedFolders = [...folders, folderWithDate];
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updatedFolders));
        return folderWithDate;
      }),
      catchError(error => {
        console.error('Error adding folder:', error);
        throw error;
      })
    );
  }

  /**
   * Update an existing folder in local storage
   */
  updateFolder(folder: Folder): Observable<Folder> {
    return this.getFolders().pipe(
      map(folders => {
        const index = folders.findIndex(f => f.id === folder.id);
        if (index === -1) {
          throw new Error(`Folder with ID ${folder.id} not found`);
        }

        // Ensure createdAt is a Date object
        const folderWithDate = {
          ...folder,
          createdAt: folder.createdAt instanceof Date ? folder.createdAt : new Date(folder.createdAt)
        };

        const updatedFolders = [...folders];
        updatedFolders[index] = folderWithDate;
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updatedFolders));
        return folderWithDate;
      }),
      catchError(error => {
        console.error('Error updating folder:', error);
        throw error;
      })
    );
  }

  /**
   * Delete a folder from local storage
   */
  deleteFolder(id: string): Observable<boolean> {
    return this.getFolders().pipe(
      map(folders => {
        const folderToDelete = folders.find(folder => folder.id === id);
        const updatedFolders = folders.filter(folder => folder.id !== id);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updatedFolders));

        // Note: The indexed files should already be cleared by IndexingService.removeFolderFromIndex
        // which is called before this method in the FoldersComponent.performFolderDeletion method

        return true;
      }),
      catchError(error => {
        console.error('Error deleting folder:', error);
        throw error;
      })
    );
  }

  /**
   * Get a single folder by ID
   */
  getFolder(id: string): Observable<Folder | null> {
    return this.getFolders().pipe(
      map(folders => {
        const folder = folders.find(f => f.id === id);
        return folder || null;
      }),
      catchError(error => {
        console.error('Error getting folder:', error);
        throw error;
      })
    );
  }

  /**
   * Check if a folder can be added for indexing
   * @param folderPath Path of the folder to check
   * @returns Observable resolving to an object with indexable status and reason if not indexable
   */
  checkFolderIndexable(folderPath: string): Observable<any> {
    return from(this.electronWindowService.checkFolderIndexable(folderPath)).pipe(
      catchError(error => {
        console.error('Error checking if folder is indexable:', error);
        return of({
          success: false,
          indexable: false,
          reason: error.toString()
        });
      })
    );
  }
}
