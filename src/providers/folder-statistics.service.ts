import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Interface for folder indexing statistics
 */
export interface FolderIndexingStats {
  indexedFiles: number;
  totalFiles: number;
  progress?: number;
  status?: 'indexing' | 'indexed' | 'stopped';
  filesInQueue?: number; // Number of files waiting to be saved to the database
}

/**
 * Service responsible for managing folder indexing statistics
 * This service is separated from the main IndexingService to improve separation of concerns
 */
@Injectable({
  providedIn: 'root'
})
export class FolderStatisticsService {
  private readonly FOLDER_STATS_KEY = 'genia_folder_stats';
  private _folderStats: Map<string, FolderIndexingStats> = new Map();
  private _folderStatsSubject = new BehaviorSubject<Map<string, FolderIndexingStats>>(this._folderStats);

  constructor() {
    // Initialize folder stats from localStorage if available
    const savedFolderStats = localStorage.getItem(this.FOLDER_STATS_KEY);
    if (savedFolderStats) {
      try {
        // Convert the JSON object back to a Map
        const statsObj = JSON.parse(savedFolderStats);
        this._folderStats = new Map(Object.entries(statsObj));
        this._folderStatsSubject.next(this._folderStats);
      } catch (error) {
        console.error('Error parsing folder stats:', error);
        this._folderStats = new Map();
      }
    }
  }

  /**
   * Get statistics for a specific folder
   * @param folderId The ID of the folder
   */
  getFolderStats(folderId: string): FolderIndexingStats | undefined {
    return this._folderStats.get(folderId);
  }

  /**
   * Get an observable of statistics for a specific folder
   * @param folderId The ID of the folder
   */
  getFolderStats$(folderId: string): Observable<FolderIndexingStats | undefined> {
    return this._folderStatsSubject.pipe(
      map(stats => stats.get(folderId))
    );
  }

  /**
   * Get all folder statistics
   */
  getAllFolderStats(): Map<string, FolderIndexingStats> {
    return new Map(this._folderStats);
  }

  /**
   * Get an observable of all folder statistics
   */
  getAllFolderStats$(): Observable<Map<string, FolderIndexingStats>> {
    return this._folderStatsSubject.asObservable();
  }

  /**
   * Update statistics for a folder
   * @param folderId The ID of the folder
   * @param stats The statistics to update
   */
  updateFolderStats(folderId: string, stats: Partial<FolderIndexingStats>): void {
    const currentStats = this._folderStats.get(folderId) || {
      indexedFiles: 0,
      totalFiles: 0,
      filesInQueue: 0
    };

    const updatedStats = {
      ...currentStats,
      ...stats
    };

    // Calculate progress if not provided, accounting for files in queue
    if (stats.indexedFiles !== undefined || stats.totalFiles !== undefined || stats.filesInQueue !== undefined) {
      const filesInQueue = updatedStats.filesInQueue || 0;

      // If there are files in the queue, cap progress at 99%
      if (filesInQueue > 0) {
        updatedStats.progress = updatedStats.totalFiles > 0
          ? Math.min(99, Math.round((updatedStats.indexedFiles / updatedStats.totalFiles) * 100))
          : 0;
      } else {
        // No files in queue, progress can reach 100%
        updatedStats.progress = updatedStats.totalFiles > 0
          ? Math.min(100, Math.round((updatedStats.indexedFiles / updatedStats.totalFiles) * 100))
          : 0;
      }
    }

    this._folderStats.set(folderId, updatedStats);
    this.saveFolderStats();
    this._folderStatsSubject.next(this._folderStats);
  }

  /**
   * Set the status of a folder
   * @param folderId The ID of the folder
   * @param status The status to set
   */
  setFolderStatus(folderId: string, status: 'indexing' | 'indexed' | 'stopped'): void {
    const currentStats = this._folderStats.get(folderId);
    if (currentStats) {
      const updatedStats = {
        ...currentStats,
        status
      };
      this._folderStats.set(folderId, updatedStats);
      this.saveFolderStats();
      this._folderStatsSubject.next(this._folderStats);
    }
  }

  /**
   * Remove statistics for a folder
   * @param folderId The ID of the folder
   */
  removeFolderStats(folderId: string): void {
    if (this._folderStats.has(folderId)) {
      this._folderStats.delete(folderId);
      this.saveFolderStats();
      this._folderStatsSubject.next(this._folderStats);
    }
  }

  /**
   * Increment the number of indexed files for a folder
   * @param folderId The ID of the folder
   * @param count The number of files to add (default: 1)
   */
  incrementIndexedFiles(folderId: string, count: number = 1): void {
    const currentStats = this._folderStats.get(folderId);
    if (currentStats) {
      const indexedFiles = currentStats.indexedFiles + count;
      const filesInQueue = currentStats.filesInQueue || 0;

      // Calculate progress, accounting for files in queue
      let progress = 0;
      if (currentStats.totalFiles > 0) {
        // If there are files in the queue, cap progress at 99%
        if (filesInQueue > 0) {
          progress = Math.min(99, Math.round((indexedFiles / currentStats.totalFiles) * 100));
        } else {
          // No files in queue, progress can reach 100%
          progress = Math.min(100, Math.round((indexedFiles / currentStats.totalFiles) * 100));
        }
      }

      const updatedStats = {
        ...currentStats,
        indexedFiles,
        progress
      };

      this._folderStats.set(folderId, updatedStats);
      this.saveFolderStats();
      this._folderStatsSubject.next(this._folderStats);
    }
  }

  /**
   * Reset all folder statistics
   */
  resetAllStats(): void {
    this._folderStats.clear();
    this.saveFolderStats();
    this._folderStatsSubject.next(this._folderStats);
  }

  /**
   * Save folder stats to localStorage
   */
  private saveFolderStats(): void {
    // Convert Map to a plain object for JSON serialization
    const statsObj = Object.fromEntries(this._folderStats);
    localStorage.setItem(this.FOLDER_STATS_KEY, JSON.stringify(statsObj));
  }
}
