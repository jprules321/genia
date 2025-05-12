import { Injectable } from '@angular/core';
import { Observable, Subject, from, of } from 'rxjs';
import { map, catchError, mergeMap, concatMap } from 'rxjs/operators';

/**
 * Interface for a task to be executed by the worker pool
 */
export interface WorkerTask<T, R> {
  id: string;
  data: T;
  execute: (data: T) => Promise<R>;
  priority?: number;
}

/**
 * Interface for a worker in the pool
 */
interface Worker<T, R> {
  id: string;
  busy: boolean;
  currentTask?: WorkerTask<T, R>;
  execute: (task: WorkerTask<T, R>) => Promise<R>;
}

/**
 * Service responsible for managing a pool of workers for parallel processing
 * This service is used to improve performance by allowing multiple files to be processed simultaneously
 */
@Injectable({
  providedIn: 'root'
})
export class WorkerPoolService {
  private workers: Worker<any, any>[] = [];
  private taskQueue: WorkerTask<any, any>[] = [];
  private maxWorkers: number;
  private taskResults = new Subject<{ taskId: string, result: any }>();
  private taskErrors = new Subject<{ taskId: string, error: any }>();

  /**
   * Observable that emits task results
   */
  public taskResults$ = this.taskResults.asObservable();

  /**
   * Observable that emits task errors
   */
  public taskErrors$ = this.taskErrors.asObservable();

  constructor() {
    // Set the maximum number of workers based on the number of CPU cores
    // For browsers, we'll use a fixed number since navigator.hardwareConcurrency is not always available
    this.maxWorkers = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;

    console.log(`Initializing worker pool with ${this.maxWorkers} workers`);

    // Initialize the worker pool
    this.initializeWorkers();
  }

  /**
   * Initialize the worker pool
   */
  private initializeWorkers(): void {
    for (let i = 0; i < this.maxWorkers; i++) {
      this.workers.push({
        id: `worker-${i}`,
        busy: false,
        execute: async (task: WorkerTask<any, any>) => {
          try {
            const result = await task.execute(task.data);
            this.taskResults.next({ taskId: task.id, result });
            return result;
          } catch (error) {
            this.taskErrors.next({ taskId: task.id, error });
            throw error;
          }
        }
      });
    }
  }

  /**
   * Add a task to the worker pool
   * @param task The task to add
   * @returns Observable that emits the task result
   */
  addTask<T, R>(task: WorkerTask<T, R>): Observable<R> {
    // Add the task to the queue
    this.taskQueue.push(task);

    // Sort the queue by priority (higher priority first)
    this.taskQueue.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // Try to execute tasks
    this.executeTasks();

    // Return an observable that will emit the task result
    return this.taskResults$.pipe(
      map(result => {
        if (result.taskId === task.id) {
          return result.result as R;
        }
        throw new Error('Task result not found');
      }),
      catchError(error => {
        console.error(`Error executing task ${task.id}:`, error);
        throw error;
      })
    );
  }

  /**
   * Execute tasks in the queue
   */
  private executeTasks(): void {
    // Find available workers
    const availableWorkers = this.workers.filter(worker => !worker.busy);

    // Assign tasks to available workers
    while (availableWorkers.length > 0 && this.taskQueue.length > 0) {
      const worker = availableWorkers.pop();
      const task = this.taskQueue.shift();

      if (worker && task) {
        worker.busy = true;
        worker.currentTask = task;

        console.log(`Worker ${worker.id} executing task ${task.id}`);

        worker.execute(task)
          .catch(error => {
            console.error(`Error executing task ${task.id}:`, error);
          })
          .finally(() => {
            worker.busy = false;
            worker.currentTask = undefined;

            // Try to execute more tasks
            this.executeTasks();
          });
      }
    }
  }

  /**
   * Execute multiple tasks in parallel
   * @param tasks Array of tasks to execute
   * @param concurrency Maximum number of tasks to execute in parallel (defaults to the number of workers)
   * @returns Observable that emits the results of all tasks
   */
  executeAll<T, R>(tasks: WorkerTask<T, R>[], concurrency?: number): Observable<R[]> {
    const results: R[] = [];
    const maxConcurrency = concurrency || this.maxWorkers;

    // Use mergeMap to execute tasks in parallel with limited concurrency
    return from(tasks).pipe(
      mergeMap(task => this.addTask(task), maxConcurrency),
      map(result => {
        results.push(result);
        return results;
      }),
      catchError(error => {
        console.error('Error executing tasks:', error);
        throw error;
      })
    );
  }

  /**
   * Execute multiple tasks sequentially
   * @param tasks Array of tasks to execute
   * @returns Observable that emits the results of all tasks
   */
  executeSequentially<T, R>(tasks: WorkerTask<T, R>[]): Observable<R[]> {
    const results: R[] = [];

    // Use concatMap to execute tasks sequentially
    return from(tasks).pipe(
      concatMap(task => this.addTask(task)),
      map(result => {
        results.push(result);
        return results;
      }),
      catchError(error => {
        console.error('Error executing tasks sequentially:', error);
        throw error;
      })
    );
  }

  /**
   * Get the number of active workers
   */
  getActiveWorkerCount(): number {
    return this.workers.filter(worker => worker.busy).length;
  }

  /**
   * Get the number of tasks in the queue
   */
  getQueueLength(): number {
    return this.taskQueue.length;
  }

  /**
   * Clear the task queue
   */
  clearQueue(): void {
    this.taskQueue = [];
  }
}
