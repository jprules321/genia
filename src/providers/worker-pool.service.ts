import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject, from, of, throwError } from 'rxjs';
import { map, catchError, finalize, tap } from 'rxjs/operators';

/**
 * Interface for a worker task
 */
export interface WorkerTask<T, R> {
  id: string;
  data: T;
  callback: (result: R) => void;
  errorCallback: (error: any) => void;
}

/**
 * Service responsible for managing a pool of workers for parallel processing
 * This service is used to improve performance by distributing work across multiple threads
 */
@Injectable({
  providedIn: 'root'
})
export class WorkerPoolService implements OnDestroy {
  private workers: Worker[] = [];
  private taskQueue: WorkerTask<any, any>[] = [];
  private activeWorkers: Map<Worker, WorkerTask<any, any> | null> = new Map();
  private isProcessing = false;
  private memoryUsageInterval: any = null;
  private memoryThresholdPercent = 80; // Default threshold at 80% of available memory

  // Memory usage statistics
  private memoryStats = {
    totalMemory: 0,
    freeMemory: 0,
    usedMemory: 0,
    usedPercent: 0,
    lastChecked: new Date()
  };

  // Subject for memory usage updates
  private memoryUsageSubject = new Subject<{
    totalMemory: number;
    freeMemory: number;
    usedMemory: number;
    usedPercent: number;
    lastChecked: Date;
  }>();

  // Observable for memory usage updates
  public memoryUsage$ = this.memoryUsageSubject.asObservable();

  constructor() {
    // Initialize the worker pool
    this.initializeWorkerPool();

    // Start monitoring memory usage
    this.startMemoryMonitoring();
  }

  ngOnDestroy(): void {
    this.terminateWorkerPool();
    this.stopMemoryMonitoring();
  }

  /**
   * Initialize the worker pool with the optimal number of workers
   */
  private initializeWorkerPool(): void {
    // Determine the optimal number of workers based on CPU cores
    // Use navigator.hardwareConcurrency if available, otherwise default to 4
    const optimalWorkerCount = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? Math.max(1, navigator.hardwareConcurrency - 1) // Leave one core for the main thread
      : 4;

    console.log(`Initializing worker pool with ${optimalWorkerCount} workers`);

    // Create the workers
    for (let i = 0; i < optimalWorkerCount; i++) {
      this.createWorker();
    }
  }

  /**
   * Create a new worker
   */
  private createWorker(): Worker {
    // Create a worker from a blob URL
    const workerScript = `
      self.onmessage = function(e) {
        const { taskId, data, type } = e.data;

        try {
          let result;

          // Process the task based on its type
          switch (type) {
            case 'processFile':
              result = processFile(data);
              break;
            case 'calculateEmbeddings':
              result = calculateEmbeddings(data);
              break;
            case 'parseContent':
              result = parseContent(data);
              break;
            default:
              throw new Error('Unknown task type: ' + type);
          }

          // Send the result back to the main thread
          self.postMessage({
            taskId,
            result,
            error: null
          });
        } catch (error) {
          // Send the error back to the main thread
          self.postMessage({
            taskId,
            result: null,
            error: error.message || 'Unknown error'
          });
        }
      };

      // Function to process a file
      function processFile(data) {
        const { content, options } = data;

        // Simple content processing for demonstration
        // In a real implementation, this would do more complex processing
        const lines = content.split('\\n');
        const wordCount = content.split(/\\s+/).length;
        const charCount = content.length;

        return {
          lines: lines.length,
          words: wordCount,
          chars: charCount,
          processed: true
        };
      }

      // Function to calculate embeddings
      function calculateEmbeddings(data) {
        const { text, options } = data;

        // Simulate embedding calculation
        // In a real implementation, this would use a proper embedding algorithm
        const embedding = new Array(options?.dimensions || 128).fill(0).map(() => Math.random());

        return {
          embedding,
          dimensions: embedding.length
        };
      }

      // Function to parse content
      function parseContent(data) {
        const { content, format } = data;

        // Simple content parsing for demonstration
        // In a real implementation, this would handle different formats
        let parsed;

        try {
          if (format === 'json') {
            parsed = JSON.parse(content);
          } else if (format === 'csv') {
            parsed = content.split('\\n').map(line => line.split(','));
          } else {
            // Default to text
            parsed = { text: content };
          }
        } catch (error) {
          throw new Error('Failed to parse content: ' + error.message);
        }

        return {
          parsed,
          format
        };
      }
    `;

    const blob = new Blob([workerScript], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));

    // Set up message handler
    worker.onmessage = (e) => {
      const { taskId, result, error } = e.data;

      // Find the task
      const task = this.activeWorkers.get(worker);

      if (!task) {
        console.error(`Received message for unknown task: ${taskId}`);
        return;
      }

      // Handle the result or error
      if (error) {
        task.errorCallback(error);
      } else {
        task.callback(result);
      }

      // Mark the worker as free
      this.activeWorkers.set(worker, null);

      // Process the next task
      this.processNextTask();
    };

    // Handle worker errors
    worker.onerror = (error) => {
      console.error('Worker error:', error);

      // Find the task
      const task = this.activeWorkers.get(worker);

      if (task) {
        task.errorCallback(error);

        // Mark the worker as free
        this.activeWorkers.set(worker, null);
      }

      // Process the next task
      this.processNextTask();
    };

    // Add the worker to the pool
    this.workers.push(worker);
    this.activeWorkers.set(worker, null);

    return worker;
  }

  /**
   * Terminate the worker pool
   */
  private terminateWorkerPool(): void {
    console.log(`Terminating worker pool with ${this.workers.length} workers`);

    // Terminate all workers
    for (const worker of this.workers) {
      worker.terminate();
    }

    // Clear the arrays
    this.workers = [];
    this.activeWorkers.clear();
    this.taskQueue = [];
    this.isProcessing = false;
  }

  /**
   * Submit a task to the worker pool
   * @param type Type of task to perform
   * @param data Data for the task
   * @returns Observable of the task result
   */
  submitTask<T, R>(type: string, data: T): Observable<R> {
    return new Observable<R>(subscriber => {
      // Create a task
      const task: WorkerTask<T, R> = {
        id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        data,
        callback: (result) => {
          subscriber.next(result);
          subscriber.complete();
        },
        errorCallback: (error) => {
          subscriber.error(error);
        }
      };

      // Add the task to the queue
      this.taskQueue.push(task);

      // Start processing if not already
      if (!this.isProcessing) {
        this.processNextTask();
      }

      // Return cleanup function
      return () => {
        // Remove the task from the queue if it hasn't started yet
        const index = this.taskQueue.findIndex(t => t.id === task.id);
        if (index !== -1) {
          this.taskQueue.splice(index, 1);
        }
      };
    });
  }

  /**
   * Process the next task in the queue
   */
  private processNextTask(): void {
    // Skip if no tasks or already processing
    if (this.taskQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;

    // Check if memory usage is too high
    if (this.memoryStats.usedPercent > this.memoryThresholdPercent) {
      console.log(`Memory usage is high (${this.memoryStats.usedPercent.toFixed(2)}%), pausing task processing`);

      // Wait for memory to free up
      setTimeout(() => {
        this.updateMemoryUsage().then(() => {
          this.processNextTask();
        });
      }, 1000);

      return;
    }

    // Find a free worker
    const freeWorker = this.findFreeWorker();

    if (!freeWorker) {
      // No free workers, wait for one to become available
      return;
    }

    // Get the next task
    const task = this.taskQueue.shift();

    if (!task) {
      this.isProcessing = false;
      return;
    }

    // Assign the task to the worker
    this.activeWorkers.set(freeWorker, task);

    // Send the task to the worker
    freeWorker.postMessage({
      taskId: task.id,
      data: task.data,
      type: task.type
    });
  }

  /**
   * Find a free worker
   * @returns A free worker, or null if none are available
   */
  private findFreeWorker(): Worker | null {
    for (const [worker, task] of this.activeWorkers.entries()) {
      if (task === null) {
        return worker;
      }
    }

    return null;
  }

  /**
   * Start monitoring memory usage
   */
  private startMemoryMonitoring(): void {
    // Update memory usage immediately
    this.updateMemoryUsage();

    // Set up interval to check memory usage
    this.memoryUsageInterval = setInterval(() => {
      this.updateMemoryUsage();
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop monitoring memory usage
   */
  private stopMemoryMonitoring(): void {
    if (this.memoryUsageInterval) {
      clearInterval(this.memoryUsageInterval);
      this.memoryUsageInterval = null;
    }
  }

  /**
   * Update memory usage statistics
   */
  private async updateMemoryUsage(): Promise<void> {
    try {
      // Use performance.memory if available (Chrome only)
      if (window.performance && (performance as any).memory) {
        const memory = (performance as any).memory;

        this.memoryStats = {
          totalMemory: memory.jsHeapSizeLimit,
          usedMemory: memory.usedJSHeapSize,
          freeMemory: memory.jsHeapSizeLimit - memory.usedJSHeapSize,
          usedPercent: (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100,
          lastChecked: new Date()
        };
      } else {
        // Fallback to navigator.deviceMemory if available
        if (navigator && (navigator as any).deviceMemory) {
          const totalMemory = (navigator as any).deviceMemory * 1024 * 1024 * 1024; // Convert GB to bytes

          // Estimate used memory (very rough approximation)
          const usedMemory = totalMemory * 0.5; // Assume 50% usage

          this.memoryStats = {
            totalMemory,
            usedMemory,
            freeMemory: totalMemory - usedMemory,
            usedPercent: 50, // Fixed at 50%
            lastChecked: new Date()
          };
        } else {
          // No memory info available, use defaults
          this.memoryStats = {
            totalMemory: 4 * 1024 * 1024 * 1024, // Assume 4GB
            usedMemory: 2 * 1024 * 1024 * 1024, // Assume 2GB used
            freeMemory: 2 * 1024 * 1024 * 1024, // Assume 2GB free
            usedPercent: 50, // Fixed at 50%
            lastChecked: new Date()
          };
        }
      }

      // Emit memory usage update
      this.memoryUsageSubject.next({ ...this.memoryStats });

    } catch (error) {
      console.error('Error updating memory usage:', error);
    }
  }

  /**
   * Set the memory threshold percentage
   * @param percent Percentage threshold (0-100)
   */
  setMemoryThreshold(percent: number): void {
    this.memoryThresholdPercent = Math.max(0, Math.min(100, percent));
  }

  /**
   * Get the current memory usage statistics
   * @returns Memory usage statistics
   */
  getMemoryUsage(): {
    totalMemory: number;
    freeMemory: number;
    usedMemory: number;
    usedPercent: number;
    lastChecked: Date;
  } {
    return { ...this.memoryStats };
  }

  /**
   * Process a file using a worker
   * @param content File content
   * @param options Processing options
   * @returns Observable of the processing result
   */
  processFile(content: string, options?: any): Observable<{
    lines: number;
    words: number;
    chars: number;
    processed: boolean;
  }> {
    return this.submitTask('processFile', { content, options });
  }

  /**
   * Calculate embeddings for text using a worker
   * @param text Text to embed
   * @param options Embedding options
   * @returns Observable of the embedding result
   */
  calculateEmbeddings(text: string, options?: { dimensions?: number }): Observable<{
    embedding: number[];
    dimensions: number;
  }> {
    return this.submitTask('calculateEmbeddings', { text, options });
  }

  /**
   * Parse content using a worker
   * @param content Content to parse
   * @param format Format of the content (json, csv, etc.)
   * @returns Observable of the parsing result
   */
  parseContent(content: string, format: string): Observable<{
    parsed: any;
    format: string;
  }> {
    return this.submitTask('parseContent', { content, format });
  }
}
