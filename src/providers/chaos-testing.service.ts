import { Injectable } from '@angular/core';
import { Observable, of, timer, Subject, throwError } from 'rxjs';
import { map, delay, mergeMap, tap } from 'rxjs/operators';
import { FeatureFlagsService } from './feature-flags.service';
import { ErrorHandlerService, ErrorContext, ErrorCategory } from './error-handler.service';

// Chaos event interface
export interface ChaosEvent {
  id: string;
  type: ChaosEventType;
  target: string;
  description: string;
  probability: number;
  duration?: number;
  enabled: boolean;
  lastTriggered?: Date;
}

// Chaos event types
export enum ChaosEventType {
  LATENCY = 'latency',
  ERROR = 'error',
  MEMORY_LEAK = 'memory_leak',
  RESOURCE_EXHAUSTION = 'resource_exhaustion',
  NETWORK_PARTITION = 'network_partition'
}

// Chaos event result
export interface ChaosEventResult {
  event: ChaosEvent;
  triggered: boolean;
  timestamp: Date;
  details?: any;
}

@Injectable({
  providedIn: 'root'
})
export class ChaosTestingService {
  // Storage key for chaos events
  private readonly STORAGE_KEY = 'genia_chaos_events';

  // Default chaos events
  private readonly DEFAULT_EVENTS: ChaosEvent[] = [
    {
      id: 'network-latency',
      type: ChaosEventType.LATENCY,
      target: 'network',
      description: 'Introduces random latency to network requests',
      probability: 0.1, // 10% chance
      duration: 2000, // 2 seconds
      enabled: false
    },
    {
      id: 'database-error',
      type: ChaosEventType.ERROR,
      target: 'database',
      description: 'Simulates database query errors',
      probability: 0.05, // 5% chance
      enabled: false
    },
    {
      id: 'file-system-error',
      type: ChaosEventType.ERROR,
      target: 'file-system',
      description: 'Simulates file system errors',
      probability: 0.05, // 5% chance
      enabled: false
    },
    {
      id: 'memory-leak',
      type: ChaosEventType.MEMORY_LEAK,
      target: 'application',
      description: 'Simulates a memory leak by allocating memory',
      probability: 0.01, // 1% chance
      duration: 30000, // 30 seconds
      enabled: false
    },
    {
      id: 'resource-exhaustion',
      type: ChaosEventType.RESOURCE_EXHAUSTION,
      target: 'cpu',
      description: 'Simulates CPU resource exhaustion',
      probability: 0.01, // 1% chance
      duration: 5000, // 5 seconds
      enabled: false
    }
  ];

  // Chaos events
  private events: ChaosEvent[] = [...this.DEFAULT_EVENTS];

  // Event subject for monitoring chaos events
  private eventSubject = new Subject<ChaosEventResult>();

  // Memory leak simulation array
  private memoryLeakArray: any[] = [];

  constructor(
    private featureFlagsService: FeatureFlagsService,
    private errorHandler: ErrorHandlerService
  ) {
    // Load chaos events from storage
    this.loadEvents();

    // Clean up any lingering memory leaks on service initialization
    this.cleanupMemoryLeaks();
  }

  /**
   * Get all chaos events
   * @returns Array of chaos events
   */
  getEvents(): ChaosEvent[] {
    return [...this.events];
  }

  /**
   * Get chaos event by ID
   * @param id The event ID
   * @returns The chaos event or undefined if not found
   */
  getEvent(id: string): ChaosEvent | undefined {
    return this.events.find(e => e.id === id);
  }

  /**
   * Enable a chaos event
   * @param id The event ID
   * @returns Boolean indicating success
   */
  enableEvent(id: string): boolean {
    const event = this.events.find(e => e.id === id);
    if (!event) {
      return false;
    }

    event.enabled = true;
    this.saveEvents();
    return true;
  }

  /**
   * Disable a chaos event
   * @param id The event ID
   * @returns Boolean indicating success
   */
  disableEvent(id: string): boolean {
    const event = this.events.find(e => e.id === id);
    if (!event) {
      return false;
    }

    event.enabled = false;
    this.saveEvents();
    return true;
  }

  /**
   * Add a new chaos event
   * @param event The chaos event to add
   * @returns Boolean indicating success
   */
  addEvent(event: ChaosEvent): boolean {
    if (this.events.some(e => e.id === event.id)) {
      return false;
    }

    this.events.push(event);
    this.saveEvents();
    return true;
  }

  /**
   * Update a chaos event
   * @param event The updated chaos event
   * @returns Boolean indicating success
   */
  updateEvent(event: ChaosEvent): boolean {
    const index = this.events.findIndex(e => e.id === event.id);
    if (index === -1) {
      return false;
    }

    this.events[index] = event;
    this.saveEvents();
    return true;
  }

  /**
   * Remove a chaos event
   * @param id The event ID to remove
   * @returns Boolean indicating success
   */
  removeEvent(id: string): boolean {
    const index = this.events.findIndex(e => e.id === id);
    if (index === -1) {
      return false;
    }

    this.events.splice(index, 1);
    this.saveEvents();
    return true;
  }

  /**
   * Reset chaos events to defaults
   */
  resetToDefaults(): void {
    this.events = [...this.DEFAULT_EVENTS];
    this.saveEvents();
  }

  /**
   * Get an observable of chaos events
   * @returns Observable of chaos event results
   */
  onChaosEvent(): Observable<ChaosEventResult> {
    return this.eventSubject.asObservable();
  }

  /**
   * Apply chaos to a network request
   * @param target The target identifier (e.g., 'database', 'api')
   * @param request The request observable
   * @returns The request observable with chaos applied
   */
  applyNetworkChaos<T>(target: string, request: Observable<T>): Observable<T> {
    // Check if chaos testing is enabled via feature flag
    if (!this.featureFlagsService.isEnabledSync('chaos-testing')) {
      return request;
    }

    // Find applicable chaos events
    const latencyEvents = this.events.filter(e =>
      e.enabled &&
      e.type === ChaosEventType.LATENCY &&
      (e.target === target || e.target === 'network')
    );

    const errorEvents = this.events.filter(e =>
      e.enabled &&
      e.type === ChaosEventType.ERROR &&
      (e.target === target || e.target === 'network')
    );

    // Apply latency chaos
    let chaosRequest = request;
    for (const event of latencyEvents) {
      if (Math.random() < event.probability) {
        const latency = event.duration || 1000;
        chaosRequest = chaosRequest.pipe(
          delay(latency),
          tap(() => {
            event.lastTriggered = new Date();
            this.notifyChaosEvent(event, true, { latency });
          })
        );
      }
    }

    // Apply error chaos
    for (const event of errorEvents) {
      if (Math.random() < event.probability) {
        chaosRequest = chaosRequest.pipe(
          mergeMap(result => {
            event.lastTriggered = new Date();
            this.notifyChaosEvent(event, true);

            // Create a context for the error
            const context = this.errorHandler.createErrorContext(
              'ChaosTestingService',
              'applyNetworkChaos',
              { target, event }
            );

            // Create a simulated error
            const error = new Error(`Chaos testing: Simulated ${target} error`);
            const appError = this.errorHandler.normalizeError(error, context);

            // Throw the error
            return throwError(() => appError);
          })
        );
      }
    }

    return chaosRequest;
  }

  /**
   * Simulate a memory leak
   * @param sizeInMB The size of the memory leak in MB
   * @param duration The duration of the leak in milliseconds
   */
  simulateMemoryLeak(sizeInMB: number = 10, duration: number = 30000): void {
    // Check if chaos testing is enabled via feature flag
    if (!this.featureFlagsService.isEnabledSync('chaos-testing')) {
      return;
    }

    const event = this.events.find(e =>
      e.enabled &&
      e.type === ChaosEventType.MEMORY_LEAK
    );

    if (!event || Math.random() >= event.probability) {
      return;
    }

    // Create a large array to simulate a memory leak
    const bytesPerMB = 1024 * 1024;
    const totalBytes = sizeInMB * bytesPerMB;
    const chunkSize = 1024; // 1KB chunks

    // Allocate memory in chunks
    for (let i = 0; i < totalBytes / chunkSize; i++) {
      this.memoryLeakArray.push(new Array(chunkSize).fill('A'));
    }

    // Notify about the event
    event.lastTriggered = new Date();
    this.notifyChaosEvent(event, true, { sizeInMB, duration });

    // Clean up after the specified duration
    setTimeout(() => {
      this.cleanupMemoryLeaks();
    }, duration);
  }

  /**
   * Simulate CPU resource exhaustion
   * @param duration The duration of the exhaustion in milliseconds
   */
  simulateCpuExhaustion(duration: number = 5000): void {
    // Check if chaos testing is enabled via feature flag
    if (!this.featureFlagsService.isEnabledSync('chaos-testing')) {
      return;
    }

    const event = this.events.find(e =>
      e.enabled &&
      e.type === ChaosEventType.RESOURCE_EXHAUSTION &&
      e.target === 'cpu'
    );

    if (!event || Math.random() >= event.probability) {
      return;
    }

    // Notify about the event
    event.lastTriggered = new Date();
    this.notifyChaosEvent(event, true, { duration });

    // Simulate CPU exhaustion
    const endTime = Date.now() + duration;
    while (Date.now() < endTime) {
      // Busy loop to consume CPU
      for (let i = 0; i < 1000000; i++) {
        Math.random() * Math.random();
      }
    }
  }

  /**
   * Clean up memory leaks
   */
  private cleanupMemoryLeaks(): void {
    this.memoryLeakArray = [];
  }

  /**
   * Notify about a chaos event
   * @param event The chaos event
   * @param triggered Whether the event was triggered
   * @param details Optional details about the event
   */
  private notifyChaosEvent(event: ChaosEvent, triggered: boolean, details?: any): void {
    const result: ChaosEventResult = {
      event,
      triggered,
      timestamp: new Date(),
      details
    };

    this.eventSubject.next(result);

    // Log the event
    console.log(`Chaos event ${event.id} ${triggered ? 'triggered' : 'checked'}:`, result);
  }

  /**
   * Load chaos events from storage
   */
  private loadEvents(): void {
    try {
      const storedEvents = localStorage.getItem(this.STORAGE_KEY);
      if (storedEvents) {
        this.events = JSON.parse(storedEvents);

        // Convert date strings to Date objects
        this.events.forEach(event => {
          if (event.lastTriggered) {
            event.lastTriggered = new Date(event.lastTriggered);
          }
        });
      }
    } catch (error) {
      console.error('Error loading chaos events from storage:', error);
      // Use default events
      this.events = [...this.DEFAULT_EVENTS];
    }
  }

  /**
   * Save chaos events to storage
   */
  private saveEvents(): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.events));
    } catch (error) {
      console.error('Error saving chaos events to storage:', error);
    }
  }
}
