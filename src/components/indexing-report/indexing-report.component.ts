import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { IndexingProgressService, IndexingProgress } from '../../providers/indexing-progress.service';

@Component({
  selector: 'app-indexing-report',
  templateUrl: './indexing-report.component.html',
  styleUrls: ['./indexing-report.component.scss']
})
export class IndexingReportComponent implements OnInit, OnDestroy {
  // Progress data
  progress: IndexingProgress;

  // Formatted time values
  elapsedTimeFormatted: string = '';
  estimatedTimeRemainingFormatted: string = '';

  // Subscription to progress updates
  private progressSubscription: Subscription;

  // Show detailed report
  showDetailedReport: boolean = false;

  // HTML report content
  detailedReportHtml: string = '';

  constructor(private indexingProgressService: IndexingProgressService) {
    // Initialize with default progress
    this.progress = this.indexingProgressService.getProgress();
  }

  ngOnInit(): void {
    // Subscribe to progress updates
    this.progressSubscription = this.indexingProgressService.getProgress$().subscribe(
      progress => {
        this.progress = progress;

        // Format time values
        this.elapsedTimeFormatted = this.indexingProgressService.formatTime(progress.elapsedTimeMs);
        this.estimatedTimeRemainingFormatted = this.indexingProgressService.formatTime(progress.estimatedTimeRemainingMs);

        // Update detailed report if visible
        if (this.showDetailedReport) {
          this.updateDetailedReport();
        }
      }
    );
  }

  ngOnDestroy(): void {
    // Unsubscribe to prevent memory leaks
    if (this.progressSubscription) {
      this.progressSubscription.unsubscribe();
    }
  }

  /**
   * Toggle detailed report visibility
   */
  toggleDetailedReport(): void {
    this.showDetailedReport = !this.showDetailedReport;

    if (this.showDetailedReport) {
      this.updateDetailedReport();
    }
  }

  /**
   * Update the detailed report HTML
   */
  private updateDetailedReport(): void {
    this.detailedReportHtml = this.indexingProgressService.getDetailedReport();
  }

  /**
   * Pause indexing
   */
  pauseIndexing(): void {
    this.indexingProgressService.pauseTracking();
  }

  /**
   * Resume indexing
   */
  resumeIndexing(): void {
    this.indexingProgressService.resumeTracking();
  }

  /**
   * Cancel indexing
   */
  cancelIndexing(): void {
    // This would need to be implemented in coordination with the indexing service
    console.log('Cancel indexing requested');
  }

  /**
   * Get CSS class for progress bar
   */
  getProgressBarClass(): string {
    if (this.progress.isComplete) {
      return 'progress-bar-success';
    } else if (this.progress.isPaused) {
      return 'progress-bar-warning';
    } else if (this.progress.errorFiles > 0) {
      const errorRate = this.progress.errorFiles / this.progress.totalFiles;
      if (errorRate > 0.1) {
        return 'progress-bar-danger';
      } else {
        return 'progress-bar-warning';
      }
    } else {
      return 'progress-bar-info';
    }
  }

  /**
   * Get status text
   */
  getStatusText(): string {
    if (this.progress.isComplete) {
      return 'Complete';
    } else if (this.progress.isPaused) {
      return 'Paused';
    } else {
      return 'In Progress';
    }
  }

  /**
   * Get processing rate formatted
   */
  getProcessingRateFormatted(): string {
    return this.progress.processingRate.toFixed(2);
  }

  /**
   * Get success rate formatted
   */
  getSuccessRateFormatted(): string {
    if (this.progress.totalFiles === 0) {
      return '0%';
    }

    const processedFiles = this.progress.processedFiles;
    const errorFiles = this.progress.errorFiles;
    const successRate = ((processedFiles - errorFiles) / this.progress.totalFiles) * 100;

    return successRate.toFixed(1) + '%';
  }
}
