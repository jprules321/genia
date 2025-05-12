import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { CancellationToken } from './indexing.service';

/**
 * Interface for indexing status
 */
export interface IndexingStatus {
  inProgress: boolean;
  currentFolder?: string;
  currentFile?: string;
  progress: number; // 0-100
  error?: string;
  startTime?: Date;
  endTime?: Date;
  estimatedTimeRemaining?: number; // in milliseconds
  processingSpeed?: number; // files per second
  totalFiles?: number;
  processedFiles?: number;
  errorCount?: number;
  cancellationToken?: CancellationToken; // Token for cancelling the operation
  isCancelled?: boolean; // Whether the operation has been cancelled
}

/**
 * Service responsible for managing indexing status
 * This service is separated from the main IndexingService to improve separation of concerns
 */
@Injectable({
  providedIn: 'root'
})
export class IndexingStatusService {
  private readonly STATUS_KEY = 'genia_indexing_status';
  private _status: IndexingStatus = {
    inProgress: false,
    progress: 0
  };
  private _statusSubject = new BehaviorSubject<IndexingStatus>(this._status);

  constructor() {
    // Initialize status from localStorage if available
    const savedStatus = localStorage.getItem(this.STATUS_KEY);
    if (savedStatus) {
      this._status = JSON.parse(savedStatus);
      // Reset inProgress to false on startup
      this._status.inProgress = false;
      this.saveStatus();
      this._statusSubject.next(this._status);
    }
  }

  /**
   * Get the current indexing status
   */
  getStatus(): IndexingStatus {
    return { ...this._status };
  }

  /**
   * Get an observable of the indexing status
   */
  getStatus$(): Observable<IndexingStatus> {
    return this._statusSubject.asObservable();
  }

  /**
   * Update the indexing status
   * @param status The new status or partial status to update
   */
  updateStatus(status: Partial<IndexingStatus>): void {
    this._status = { ...this._status, ...status };
    this.saveStatus();
    this._statusSubject.next(this._status);
  }

  /**
   * Reset the indexing status to default values
   */
  resetStatus(): void {
    this._status = {
      inProgress: false,
      progress: 0
    };
    this.saveStatus();
    this._statusSubject.next(this._status);
  }

  /**
   * Start indexing operation
   * @param folder The folder being indexed
   * @param cancellationToken Optional cancellation token
   */
  startIndexing(folder: string, cancellationToken?: CancellationToken): void {
    this._status = {
      inProgress: true,
      currentFolder: folder,
      progress: 0,
      startTime: new Date(),
      cancellationToken,
      isCancelled: false
    };
    this.saveStatus();
    this._statusSubject.next(this._status);
  }

  /**
   * Complete indexing operation
   * @param success Whether the operation was successful
   * @param error Optional error message if the operation failed
   */
  completeIndexing(success: boolean, error?: string): void {
    this._status = {
      ...this._status,
      inProgress: false,
      progress: success ? 100 : this._status.progress,
      endTime: new Date(),
      error: success ? undefined : (error || this._status.error)
    };
    this.saveStatus();
    this._statusSubject.next(this._status);
  }

  /**
   * Update progress of indexing operation
   * @param progress The progress percentage (0-100)
   * @param currentFile Optional current file being processed
   * @param processedFiles Optional number of processed files
   * @param totalFiles Optional total number of files
   */
  updateProgress(
    progress: number,
    currentFile?: string,
    processedFiles?: number,
    totalFiles?: number
  ): void {
    // Calculate processing speed and estimated time remaining
    let processingSpeed: number | undefined;
    let estimatedTimeRemaining: number | undefined;

    if (this._status.startTime && processedFiles && totalFiles && processedFiles > 0) {
      const elapsedMs = new Date().getTime() - this._status.startTime.getTime();
      processingSpeed = (processedFiles / elapsedMs) * 1000; // files per second

      if (processingSpeed > 0) {
        const remainingFiles = totalFiles - processedFiles;
        estimatedTimeRemaining = (remainingFiles / processingSpeed) * 1000; // milliseconds
      }
    }

    this._status = {
      ...this._status,
      progress: Math.min(100, Math.max(0, progress)),
      currentFile,
      processedFiles,
      totalFiles,
      processingSpeed,
      estimatedTimeRemaining
    };
    this.saveStatus();
    this._statusSubject.next(this._status);
  }

  /**
   * Set error in indexing status
   * @param error The error message
   * @param errorCount Optional number of errors
   */
  setError(error: string, errorCount?: number): void {
    this._status = {
      ...this._status,
      error,
      errorCount: errorCount !== undefined ? errorCount : this._status.errorCount
    };
    this.saveStatus();
    this._statusSubject.next(this._status);
  }

  /**
   * Cancel the current indexing operation
   */
  cancelIndexing(): void {
    if (this._status.cancellationToken) {
      this._status.cancellationToken.cancel();
      this._status = {
        ...this._status,
        isCancelled: true,
        error: 'Indexation cancelled by user'
      };
      this.saveStatus();
      this._statusSubject.next(this._status);
    }
  }

  /**
   * Save current status to localStorage
   */
  private saveStatus(): void {
    localStorage.setItem(this.STATUS_KEY, JSON.stringify(this._status));
  }
}
