import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject, of, timer } from 'rxjs';
import { map, tap, switchMap } from 'rxjs/operators';

/**
 * Interface for indexing progress information
 */
export interface IndexingProgress {
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  errorFiles: number;
  percentComplete: number;
  elapsedTimeMs: number;
  estimatedTimeRemainingMs: number;
  processingRate: number; // Files per second
  startTime: Date;
  currentTime: Date;
  isComplete: boolean;
  isPaused: boolean;
  currentFile?: string;
  currentFolder?: string;
  recentErrors: Array<{
    file: string;
    error: string;
    timestamp: Date;
  }>;
  recommendations: string[];
}

/**
 * Service responsible for tracking and reporting indexing progress
 * This service provides detailed progress information and estimated time remaining
 */
@Injectable({
  providedIn: 'root'
})
export class IndexingProgressService {
  // Default progress state
  private defaultProgress: IndexingProgress = {
    totalFiles: 0,
    processedFiles: 0,
    skippedFiles: 0,
    errorFiles: 0,
    percentComplete: 0,
    elapsedTimeMs: 0,
    estimatedTimeRemainingMs: 0,
    processingRate: 0,
    startTime: new Date(),
    currentTime: new Date(),
    isComplete: false,
    isPaused: false,
    recentErrors: [],
    recommendations: []
  };

  // Current progress state
  private progress: IndexingProgress = { ...this.defaultProgress };

  // Progress subject for observables
  private progressSubject = new BehaviorSubject<IndexingProgress>({ ...this.progress });

  // Timer for updating elapsed time
  private updateTimer: any = null;

  // Processing rate history for better estimates
  private processingRateHistory: number[] = [];

  // Maximum number of recent errors to keep
  private maxRecentErrors = 10;

  // Performance thresholds for recommendations
  private thresholds = {
    slowProcessingRate: 5, // Files per second
    highErrorRate: 0.05, // 5% of files
    longEstimatedTime: 10 * 60 * 1000, // 10 minutes
    largeFileCount: 10000 // 10,000 files
  };

  constructor() {}

  /**
   * Start tracking indexing progress
   * @param totalFiles Total number of files to process
   * @param currentFolder Current folder being indexed
   */
  startTracking(totalFiles: number, currentFolder?: string): void {
    // Reset progress
    this.resetProgress();

    // Set initial values
    this.progress.totalFiles = totalFiles;
    this.progress.currentFolder = currentFolder;
    this.progress.startTime = new Date();
    this.progress.currentTime = new Date();

    // Start update timer
    this.startUpdateTimer();

    // Emit initial progress
    this.emitProgress();
  }

  /**
   * Update progress with processed files
   * @param processedCount Number of files processed
   * @param skippedCount Number of files skipped
   * @param errorCount Number of files with errors
   * @param currentFile Current file being processed
   */
  updateProgress(
    processedCount: number,
    skippedCount: number = 0,
    errorCount: number = 0,
    currentFile?: string
  ): void {
    // Update counts
    this.progress.processedFiles = processedCount;
    this.progress.skippedFiles = skippedCount;
    this.progress.errorFiles = errorCount;
    this.progress.currentFile = currentFile;

    // Calculate percent complete
    if (this.progress.totalFiles > 0) {
      this.progress.percentComplete = Math.min(
        100,
        Math.round((processedCount + skippedCount) / this.progress.totalFiles * 100)
      );
    }

    // Update current time and calculate elapsed time
    this.progress.currentTime = new Date();
    this.progress.elapsedTimeMs = this.progress.currentTime.getTime() - this.progress.startTime.getTime();

    // Calculate processing rate (files per second)
    if (this.progress.elapsedTimeMs > 0) {
      const currentRate = (processedCount + skippedCount) / (this.progress.elapsedTimeMs / 1000);

      // Add to rate history
      this.processingRateHistory.push(currentRate);

      // Keep only the last 10 rates
      if (this.processingRateHistory.length > 10) {
        this.processingRateHistory.shift();
      }

      // Use average of recent rates for smoother estimates
      this.progress.processingRate = this.processingRateHistory.reduce((sum, rate) => sum + rate, 0) /
                                    this.processingRateHistory.length;
    }

    // Estimate time remaining
    if (this.progress.processingRate > 0 && this.progress.percentComplete < 100) {
      const remainingFiles = this.progress.totalFiles - (processedCount + skippedCount);
      const remainingTimeSeconds = remainingFiles / this.progress.processingRate;
      this.progress.estimatedTimeRemainingMs = remainingTimeSeconds * 1000;
    }

    // Generate recommendations based on current progress
    this.updateRecommendations();

    // Emit updated progress
    this.emitProgress();
  }

  /**
   * Add an error to the recent errors list
   * @param file File that had an error
   * @param error Error message
   */
  addError(file: string, error: string): void {
    // Add to recent errors
    this.progress.recentErrors.unshift({
      file,
      error,
      timestamp: new Date()
    });

    // Keep only the most recent errors
    if (this.progress.recentErrors.length > this.maxRecentErrors) {
      this.progress.recentErrors.pop();
    }

    // Update error count
    this.progress.errorFiles++;

    // Emit updated progress
    this.emitProgress();
  }

  /**
   * Pause progress tracking
   */
  pauseTracking(): void {
    this.progress.isPaused = true;
    this.stopUpdateTimer();
    this.emitProgress();
  }

  /**
   * Resume progress tracking
   */
  resumeTracking(): void {
    this.progress.isPaused = false;
    this.startUpdateTimer();
    this.emitProgress();
  }

  /**
   * Complete progress tracking
   */
  completeTracking(): void {
    this.progress.isComplete = true;
    this.progress.percentComplete = 100;
    this.progress.estimatedTimeRemainingMs = 0;
    this.stopUpdateTimer();

    // Final update of elapsed time
    this.progress.currentTime = new Date();
    this.progress.elapsedTimeMs = this.progress.currentTime.getTime() - this.progress.startTime.getTime();

    // Generate final recommendations
    this.updateRecommendations();

    this.emitProgress();
  }

  /**
   * Reset progress tracking
   */
  resetProgress(): void {
    this.stopUpdateTimer();
    this.progress = { ...this.defaultProgress };
    this.processingRateHistory = [];
    this.emitProgress();
  }

  /**
   * Get current progress
   * @returns Current progress state
   */
  getProgress(): IndexingProgress {
    return { ...this.progress };
  }

  /**
   * Get progress as an observable
   * @returns Observable of progress updates
   */
  getProgress$(): Observable<IndexingProgress> {
    return this.progressSubject.asObservable();
  }

  /**
   * Start timer for updating elapsed time
   */
  private startUpdateTimer(): void {
    if (this.updateTimer) {
      return;
    }

    // Update every second
    this.updateTimer = setInterval(() => {
      if (!this.progress.isPaused && !this.progress.isComplete) {
        this.progress.currentTime = new Date();
        this.progress.elapsedTimeMs = this.progress.currentTime.getTime() - this.progress.startTime.getTime();
        this.emitProgress();
      }
    }, 1000);
  }

  /**
   * Stop update timer
   */
  private stopUpdateTimer(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * Emit progress update
   */
  private emitProgress(): void {
    this.progressSubject.next({ ...this.progress });
  }

  /**
   * Update recommendations based on current progress
   */
  private updateRecommendations(): void {
    const recommendations: string[] = [];

    // Check processing rate
    if (this.progress.processingRate < this.thresholds.slowProcessingRate &&
        this.progress.processedFiles > 100) {
      recommendations.push(
        'Processing rate is slow. Consider increasing chunk size or reducing the number of files to index.'
      );
    }

    // Check error rate
    const errorRate = this.progress.totalFiles > 0 ?
                     this.progress.errorFiles / this.progress.totalFiles : 0;

    if (errorRate > this.thresholds.highErrorRate && this.progress.errorFiles > 10) {
      recommendations.push(
        'High error rate detected. Check file permissions or exclude problematic file types.'
      );
    }

    // Check estimated time
    if (this.progress.estimatedTimeRemainingMs > this.thresholds.longEstimatedTime &&
        this.progress.percentComplete < 20) {
      recommendations.push(
        'Indexing may take a long time. Consider indexing smaller folders or using incremental indexing.'
      );
    }

    // Check total file count
    if (this.progress.totalFiles > this.thresholds.largeFileCount) {
      recommendations.push(
        'Large number of files detected. Consider using more specific folder selection or excluding unnecessary files.'
      );
    }

    // Update recommendations
    this.progress.recommendations = recommendations;
  }

  /**
   * Format time in milliseconds to a human-readable string
   * @param ms Time in milliseconds
   * @returns Formatted time string
   */
  formatTime(ms: number): string {
    if (ms <= 0) {
      return 'Complete';
    }

    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / (1000 * 60)) % 60;
    const hours = Math.floor(ms / (1000 * 60 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Get a detailed indexing report
   * @returns Detailed report as HTML string
   */
  getDetailedReport(): string {
    const p = this.progress;

    // Calculate success rate
    const successRate = p.totalFiles > 0 ?
                       ((p.processedFiles - p.errorFiles) / p.totalFiles * 100).toFixed(1) : '0';

    // Format elapsed time
    const elapsedTimeFormatted = this.formatTime(p.elapsedTimeMs);

    // Format processing rate
    const processingRateFormatted = p.processingRate.toFixed(2);

    // Build HTML report
    let report = `
      <div class="indexing-report">
        <h3>Indexing Report</h3>
        <div class="report-summary">
          <p><strong>Status:</strong> ${p.isComplete ? 'Complete' : p.isPaused ? 'Paused' : 'In Progress'}</p>
          <p><strong>Folder:</strong> ${p.currentFolder || 'N/A'}</p>
          <p><strong>Progress:</strong> ${p.percentComplete}% (${p.processedFiles + p.skippedFiles} of ${p.totalFiles} files)</p>
          <p><strong>Success Rate:</strong> ${successRate}%</p>
          <p><strong>Elapsed Time:</strong> ${elapsedTimeFormatted}</p>
          <p><strong>Processing Rate:</strong> ${processingRateFormatted} files/second</p>
        </div>

        <div class="report-details">
          <h4>Details</h4>
          <ul>
            <li>Files Processed: ${p.processedFiles}</li>
            <li>Files Skipped: ${p.skippedFiles}</li>
            <li>Files with Errors: ${p.errorFiles}</li>
            <li>Start Time: ${p.startTime.toLocaleString()}</li>
            <li>End Time: ${p.isComplete ? p.currentTime.toLocaleString() : 'N/A'}</li>
          </ul>
        </div>
    `;

    // Add recommendations if any
    if (p.recommendations.length > 0) {
      report += `
        <div class="report-recommendations">
          <h4>Recommendations</h4>
          <ul>
            ${p.recommendations.map(rec => `<li>${rec}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    // Add recent errors if any
    if (p.recentErrors.length > 0) {
      report += `
        <div class="report-errors">
          <h4>Recent Errors</h4>
          <ul>
            ${p.recentErrors.map(err =>
              `<li><strong>${err.file}</strong>: ${err.error} <small>(${err.timestamp.toLocaleString()})</small></li>`
            ).join('')}
          </ul>
        </div>
      `;
    }

    report += '</div>';

    return report;
  }

  /**
   * Set maximum number of recent errors to keep
   * @param max Maximum number of errors
   */
  setMaxRecentErrors(max: number): void {
    this.maxRecentErrors = Math.max(1, max);

    // Trim existing errors if needed
    if (this.progress.recentErrors.length > this.maxRecentErrors) {
      this.progress.recentErrors = this.progress.recentErrors.slice(0, this.maxRecentErrors);
      this.emitProgress();
    }
  }

  /**
   * Set performance thresholds for recommendations
   * @param thresholds New threshold values
   */
  setThresholds(thresholds: Partial<{
    slowProcessingRate: number;
    highErrorRate: number;
    longEstimatedTime: number;
    largeFileCount: number;
  }>): void {
    this.thresholds = {
      ...this.thresholds,
      ...thresholds
    };

    // Update recommendations with new thresholds
    this.updateRecommendations();
    this.emitProgress();
  }
}
