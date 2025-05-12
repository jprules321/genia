import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { CancellationToken } from './indexing.service';

/**
 * Enum for indexing states
 */
export enum IndexingState {
  IDLE = 'idle',
  INITIALIZING = 'initializing',
  COUNTING_FILES = 'counting_files',
  INDEXING = 'indexing',
  PAUSED = 'paused',
  CANCELLING = 'cancelling',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

/**
 * Interface for real-time indexing statistics
 */
export interface IndexingStatistics {
  // File counts
  totalFiles: number;
  processedFiles: number;
  successfulFiles: number;
  failedFiles: number;
  skippedFiles: number;

  // Performance metrics
  processingSpeed: number; // files per second
  averageFileSize: number; // in bytes
  averageProcessingTime: number; // ms per file

  // Success metrics
  successRate: number; // percentage (0-100)
  errorRate: number; // percentage (0-100)

  // Time metrics
  elapsedTime: number; // in milliseconds
  estimatedTimeRemaining: number; // in milliseconds

  // Batch metrics
  batchesProcessed: number;
  batchesSuccessful: number;
  batchesFailed: number;

  // Last updated timestamp
  lastUpdated: Date;
}

/**
 * Interface for indexing status
 */
export interface IndexingStatus {
  state: IndexingState;
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
  successfulFiles?: number; // Number of files successfully indexed
  failedFiles?: number; // Number of files that failed to index
  skippedFiles?: number; // Number of files skipped due to size, extension, etc.
  errorCount?: number;
  cancellationToken?: CancellationToken; // Token for cancelling the operation
  isCancelled?: boolean; // Whether the operation has been cancelled
  lastStateTransition?: Date; // When the state last changed
  stateHistory?: Array<{state: IndexingState, timestamp: Date}>; // History of state transitions

  // Detailed statistics
  statistics?: IndexingStatistics;

  // Status message for UI display
  statusMessage?: string;
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
    state: IndexingState.IDLE,
    progress: 0,
    stateHistory: []
  };
  private _statusSubject = new BehaviorSubject<IndexingStatus>(this._status);

  constructor() {
    // Initialize status from localStorage if available
    const savedStatus = localStorage.getItem(this.STATUS_KEY);
    if (savedStatus) {
      try {
        const parsedStatus = JSON.parse(savedStatus);

        // Convert date strings back to Date objects
        if (parsedStatus.startTime) parsedStatus.startTime = new Date(parsedStatus.startTime);
        if (parsedStatus.endTime) parsedStatus.endTime = new Date(parsedStatus.endTime);
        if (parsedStatus.lastStateTransition) parsedStatus.lastStateTransition = new Date(parsedStatus.lastStateTransition);

        if (parsedStatus.stateHistory) {
          parsedStatus.stateHistory = parsedStatus.stateHistory.map((item: any) => ({
            state: item.state,
            timestamp: new Date(item.timestamp)
          }));
        }

        // Reset to IDLE state on startup regardless of saved state
        this._status = {
          ...parsedStatus,
          state: IndexingState.IDLE,
          isCancelled: false
        };
      } catch (error) {
        console.error('Error parsing saved indexing status:', error);
        // If there's an error, use the default status
        this._status = {
          state: IndexingState.IDLE,
          progress: 0,
          stateHistory: []
        };
      }

      this.saveStatus();
      this._statusSubject.next(this._status);
    }
  }

  /**
   * Transition to a new state
   * @param newState The state to transition to
   * @param additionalProps Additional properties to update
   */
  private transitionTo(newState: IndexingState, additionalProps: Partial<IndexingStatus> = {}): void {
    const now = new Date();
    const stateHistory = [...(this._status.stateHistory || [])];

    // Add the current state to history before changing
    if (this._status.state !== newState) {
      stateHistory.push({
        state: this._status.state,
        timestamp: this._status.lastStateTransition || now
      });

      // Keep only the last 10 state transitions to avoid excessive storage
      if (stateHistory.length > 10) {
        stateHistory.shift();
      }
    }

    this._status = {
      ...this._status,
      ...additionalProps,
      state: newState,
      lastStateTransition: now,
      stateHistory
    };

    this.saveStatus();
    this._statusSubject.next(this._status);
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
   * Check if indexing is currently in progress
   */
  isIndexing(): boolean {
    return [
      IndexingState.INITIALIZING,
      IndexingState.COUNTING_FILES,
      IndexingState.INDEXING
    ].includes(this._status.state);
  }

  /**
   * Check if indexing is paused
   */
  isPaused(): boolean {
    return this._status.state === IndexingState.PAUSED;
  }

  /**
   * Check if indexing can be started
   */
  canStartIndexing(): boolean {
    return [
      IndexingState.IDLE,
      IndexingState.COMPLETED,
      IndexingState.FAILED
    ].includes(this._status.state);
  }

  /**
   * Update the indexing status
   * @param status The new status or partial status to update
   */
  updateStatus(status: Partial<IndexingStatus>): void {
    // If state is being updated, use transitionTo
    if (status.state && status.state !== this._status.state) {
      this.transitionTo(status.state, status);
    } else {
      // Otherwise just update the properties
      this._status = { ...this._status, ...status };
      this.saveStatus();
      this._statusSubject.next(this._status);
    }
  }

  /**
   * Reset the indexing status to default values
   */
  resetStatus(): void {
    this.transitionTo(IndexingState.IDLE, {
      progress: 0,
      currentFolder: undefined,
      currentFile: undefined,
      error: undefined,
      startTime: undefined,
      endTime: undefined,
      estimatedTimeRemaining: undefined,
      processingSpeed: undefined,
      totalFiles: undefined,
      processedFiles: undefined,
      errorCount: undefined,
      cancellationToken: undefined,
      isCancelled: false
    });
  }

  /**
   * Start indexing operation
   * @param folder The folder being indexed
   * @param cancellationToken Optional cancellation token
   */
  startIndexing(folder: string, cancellationToken?: CancellationToken): void {
    // First transition to INITIALIZING state
    this.transitionTo(IndexingState.INITIALIZING, {
      currentFolder: folder,
      progress: 0,
      startTime: new Date(),
      cancellationToken,
      isCancelled: false,
      error: undefined,
      endTime: undefined
    });
  }

  /**
   * Start counting files phase
   * @param folder The folder being indexed
   */
  startCountingFiles(folder: string): void {
    // Only transition if we're in a valid state
    if (this._status.state === IndexingState.INITIALIZING) {
      this.transitionTo(IndexingState.COUNTING_FILES, {
        currentFolder: folder,
        progress: 0
      });
    }
  }

  /**
   * Start actual indexing phase
   * @param totalFiles The total number of files to index
   */
  startIndexingFiles(totalFiles: number): void {
    // Only transition if we're in a valid state
    if (this._status.state === IndexingState.COUNTING_FILES) {
      this.transitionTo(IndexingState.INDEXING, {
        totalFiles,
        processedFiles: 0,
        progress: 0
      });
    }
  }

  /**
   * Pause indexing operation
   */
  pauseIndexing(): void {
    // Only allow pausing if we're currently indexing
    if (this.isIndexing()) {
      this.transitionTo(IndexingState.PAUSED);
    }
  }

  /**
   * Resume indexing operation
   */
  resumeIndexing(): void {
    // Only allow resuming if we're paused
    if (this._status.state === IndexingState.PAUSED) {
      this.transitionTo(IndexingState.INDEXING);
    }
  }

  /**
   * Complete indexing operation
   * @param success Whether the operation was successful
   * @param error Optional error message if the operation failed
   */
  completeIndexing(success: boolean, error?: string): void {
    const newState = success ? IndexingState.COMPLETED : IndexingState.FAILED;

    this.transitionTo(newState, {
      progress: success ? 100 : this._status.progress,
      endTime: new Date(),
      error: success ? undefined : (error || this._status.error)
    });
  }

  /**
   * Update progress of indexing operation with enhanced accuracy and detailed statistics
   * @param progress The progress percentage (0-100) or undefined to calculate automatically
   * @param currentFile Optional current file being processed
   * @param processedFiles Optional number of processed files
   * @param totalFiles Optional total number of files
   * @param successfulFiles Optional number of successfully indexed files
   * @param failedFiles Optional number of files that failed to index
   * @param skippedFiles Optional number of files skipped due to size, extension, etc.
   * @param batchStats Optional batch processing statistics
   */
  updateProgress(
    progress?: number,
    currentFile?: string,
    processedFiles?: number,
    totalFiles?: number,
    successfulFiles?: number,
    failedFiles?: number,
    skippedFiles?: number,
    batchStats?: {
      batchesProcessed?: number,
      batchesSuccessful?: number,
      batchesFailed?: number,
      averageFileSize?: number,
      averageProcessingTime?: number
    }
  ): void {
    // Only update progress if we're in an active state
    if (!this.isIndexing() && this._status.state !== IndexingState.PAUSED) {
      return;
    }

    // Use existing values if not provided
    processedFiles = processedFiles ?? this._status.processedFiles ?? 0;
    totalFiles = totalFiles ?? this._status.totalFiles ?? 0;
    successfulFiles = successfulFiles ?? this._status.successfulFiles ?? 0;
    failedFiles = failedFiles ?? this._status.failedFiles ?? 0;
    skippedFiles = skippedFiles ?? this._status.skippedFiles ?? 0;

    // Calculate progress if not provided
    if (progress === undefined && totalFiles > 0) {
      // Calculate progress based on processed, skipped, and failed files
      const totalProcessed = processedFiles + skippedFiles;
      progress = Math.min(100, Math.max(0, (totalProcessed / totalFiles) * 100));
    } else if (progress === undefined) {
      // If we can't calculate progress, use the existing value or 0
      progress = this._status.progress ?? 0;
    }

    // Calculate time metrics
    const now = new Date();
    let elapsedMs = 0;
    let processingSpeed = 0;
    let estimatedTimeRemaining: number | undefined;

    if (this._status.startTime) {
      elapsedMs = now.getTime() - this._status.startTime.getTime();

      // Calculate processing speed (files per second)
      if (processedFiles > 0 && elapsedMs > 0) {
        processingSpeed = (processedFiles / elapsedMs) * 1000;
      }

      // Calculate estimated time remaining
      if (processingSpeed > 0 && totalFiles > 0) {
        const remainingFiles = totalFiles - processedFiles - skippedFiles;
        estimatedTimeRemaining = (remainingFiles / processingSpeed) * 1000; // milliseconds
      }
    }

    // Calculate success and error rates
    const totalAttempted = successfulFiles + failedFiles;
    const successRate = totalAttempted > 0 ? (successfulFiles / totalAttempted) * 100 : 100;
    const errorRate = totalAttempted > 0 ? (failedFiles / totalAttempted) * 100 : 0;

    // Create detailed statistics object
    const statistics: IndexingStatistics = {
      totalFiles,
      processedFiles,
      successfulFiles,
      failedFiles,
      skippedFiles,

      processingSpeed,
      averageFileSize: batchStats?.averageFileSize ?? 0,
      averageProcessingTime: batchStats?.averageProcessingTime ?? 0,

      successRate,
      errorRate,

      elapsedTime: elapsedMs,
      estimatedTimeRemaining: estimatedTimeRemaining ?? 0,

      batchesProcessed: batchStats?.batchesProcessed ?? 0,
      batchesSuccessful: batchStats?.batchesSuccessful ?? 0,
      batchesFailed: batchStats?.batchesFailed ?? 0,

      lastUpdated: now
    };

    // Generate a status message for UI display
    const statusMessage = this.generateStatusMessage(statistics);

    // Update without changing state
    this._status = {
      ...this._status,
      progress: Math.min(100, Math.max(0, progress)),
      currentFile,
      processedFiles,
      totalFiles,
      successfulFiles,
      failedFiles,
      skippedFiles,
      processingSpeed,
      estimatedTimeRemaining,
      statistics,
      statusMessage
    };

    this.saveStatus();
    this._statusSubject.next(this._status);
  }

  /**
   * Generate a human-readable status message based on current statistics
   * @param stats The current indexing statistics
   * @returns A formatted status message for UI display
   */
  private generateStatusMessage(stats: IndexingStatistics): string {
    if (stats.totalFiles === 0) {
      return 'Preparing to index files...';
    }

    const totalProcessed = stats.processedFiles + stats.skippedFiles;
    const progressPercent = Math.round((totalProcessed / stats.totalFiles) * 100);

    let message = `Processed ${totalProcessed} of ${stats.totalFiles} files (${progressPercent}%)`;

    if (stats.skippedFiles > 0) {
      message += `, skipped ${stats.skippedFiles}`;
    }

    if (stats.failedFiles > 0) {
      message += `, ${stats.failedFiles} failed`;
    }

    if (stats.processingSpeed > 0) {
      message += `, ${stats.processingSpeed.toFixed(1)} files/sec`;
    }

    if (stats.estimatedTimeRemaining > 0) {
      const remainingSeconds = Math.ceil(stats.estimatedTimeRemaining / 1000);
      if (remainingSeconds < 60) {
        message += `, ${remainingSeconds} sec remaining`;
      } else {
        const remainingMinutes = Math.ceil(remainingSeconds / 60);
        message += `, ${remainingMinutes} min remaining`;
      }
    }

    return message;
  }

  /**
   * Update indexing statistics with batch processing results
   * @param batchResults Results from processing a batch of files
   */
  updateBatchStatistics(batchResults: {
    success: boolean,
    count: number,
    errors?: any[],
    performance?: {
      totalTimeMs: number,
      averageTimePerFileMs: number,
      filesPerSecond: number
    }
  }): void {
    // Only update if we're in an active state
    if (!this.isIndexing() && this._status.state !== IndexingState.PAUSED) {
      return;
    }

    // Get current statistics or initialize new ones
    const currentStats = this._status.statistics || {
      totalFiles: this._status.totalFiles || 0,
      processedFiles: this._status.processedFiles || 0,
      successfulFiles: this._status.successfulFiles || 0,
      failedFiles: this._status.failedFiles || 0,
      skippedFiles: this._status.skippedFiles || 0,
      processingSpeed: 0,
      averageFileSize: 0,
      averageProcessingTime: 0,
      successRate: 100,
      errorRate: 0,
      elapsedTime: 0,
      estimatedTimeRemaining: 0,
      batchesProcessed: 0,
      batchesSuccessful: 0,
      batchesFailed: 0,
      lastUpdated: new Date()
    };

    // Update batch statistics
    const batchesProcessed = currentStats.batchesProcessed + 1;
    const batchesSuccessful = currentStats.batchesSuccessful + (batchResults.success ? 1 : 0);
    const batchesFailed = currentStats.batchesFailed + (batchResults.success ? 0 : 1);

    // Update file counts
    const successfulFiles = currentStats.successfulFiles + batchResults.count;
    const failedFiles = currentStats.failedFiles + (batchResults.errors?.length || 0);

    // Update performance metrics if available
    let averageProcessingTime = currentStats.averageProcessingTime;
    let processingSpeed = currentStats.processingSpeed;

    if (batchResults.performance) {
      // Weighted average to smooth out fluctuations
      averageProcessingTime = (currentStats.averageProcessingTime * 0.7) +
                             (batchResults.performance.averageTimePerFileMs * 0.3);

      processingSpeed = (currentStats.processingSpeed * 0.7) +
                       (batchResults.performance.filesPerSecond * 0.3);
    }

    // Update progress with the new statistics
    this.updateProgress(
      undefined, // Let updateProgress calculate the progress
      this._status.currentFile,
      this._status.processedFiles,
      this._status.totalFiles,
      successfulFiles,
      failedFiles,
      this._status.skippedFiles,
      {
        batchesProcessed,
        batchesSuccessful,
        batchesFailed,
        averageFileSize: currentStats.averageFileSize,
        averageProcessingTime
      }
    );
  }

  /**
   * Set error in indexing status
   * @param error The error message
   * @param errorCount Optional number of errors
   * @param transitionToFailed Whether to transition to FAILED state
   */
  setError(error: string, errorCount?: number, transitionToFailed: boolean = false): void {
    if (transitionToFailed) {
      this.transitionTo(IndexingState.FAILED, {
        error,
        errorCount: errorCount !== undefined ? errorCount : this._status.errorCount
      });
    } else {
      // Update without changing state
      this._status = {
        ...this._status,
        error,
        errorCount: errorCount !== undefined ? errorCount : this._status.errorCount
      };
      this.saveStatus();
      this._statusSubject.next(this._status);
    }
  }

  /**
   * Cancel the current indexing operation
   */
  cancelIndexing(): void {
    // Only allow cancelling if we're in an active state
    if (this.isIndexing() || this._status.state === IndexingState.PAUSED) {
      // First transition to CANCELLING state
      this.transitionTo(IndexingState.CANCELLING, {
        isCancelled: true
      });

      // Then cancel the token
      if (this._status.cancellationToken) {
        this._status.cancellationToken.cancel();
      }

      // Finally transition to IDLE state
      this.transitionTo(IndexingState.IDLE, {
        error: 'Indexation cancelled by user',
        endTime: new Date()
      });
    }
  }

  /**
   * Save current status to localStorage
   */
  private saveStatus(): void {
    localStorage.setItem(this.STATUS_KEY, JSON.stringify(this._status));
  }
}
