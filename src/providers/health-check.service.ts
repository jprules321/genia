import { Injectable } from '@angular/core';
import { Observable, of, timer, BehaviorSubject, Subject, from } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { ElectronWindowService } from './electron-window.service';
import { ErrorHandlerService, ErrorContext } from './error-handler.service';

// Health status enum
export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  UNKNOWN = 'unknown'
}

// Health check result interface
export interface HealthCheckResult {
  component: string;
  status: HealthStatus;
  details?: any;
  timestamp: Date;
  responseTime?: number;
}

// System health interface
export interface SystemHealth {
  status: HealthStatus;
  components: HealthCheckResult[];
  timestamp: Date;
}

@Injectable({
  providedIn: 'root'
})
export class HealthCheckService {
  // System health subject
  private healthSubject = new BehaviorSubject<SystemHealth>({
    status: HealthStatus.UNKNOWN,
    components: [],
    timestamp: new Date()
  });

  // Health check interval in milliseconds (default: 60 seconds)
  private healthCheckInterval = 60000;

  // Health check timeout in milliseconds (default: 10 seconds)
  private healthCheckTimeout = 10000;

  // Flag to indicate if health checks are running
  private isRunning = false;

  // Health check components
  private components: {
    name: string;
    check: () => Observable<HealthCheckResult>;
    critical: boolean;
  }[] = [];

  constructor(
    private http: HttpClient,
    private electronWindowService: ElectronWindowService,
    private errorHandler: ErrorHandlerService
  ) {
    // Register default health checks
    this.registerDatabaseHealthCheck();
    this.registerElectronHealthCheck();
    this.registerFileSystemHealthCheck();
  }

  /**
   * Get the current system health
   * @returns Observable of system health
   */
  getHealth(): Observable<SystemHealth> {
    return this.healthSubject.asObservable();
  }

  /**
   * Start health checks
   * @param interval Optional interval in milliseconds
   */
  startHealthChecks(interval?: number): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.healthCheckInterval = interval || this.healthCheckInterval;

    // Run health checks immediately and then at the specified interval
    this.runHealthChecks();
    timer(this.healthCheckInterval, this.healthCheckInterval)
      .pipe(
        switchMap(() => this.runHealthChecks())
      )
      .subscribe();
  }

  /**
   * Stop health checks
   */
  stopHealthChecks(): void {
    this.isRunning = false;
  }

  /**
   * Run all health checks
   * @returns Observable of system health
   */
  runHealthChecks(): Observable<SystemHealth> {
    const startTime = Date.now();
    const context = this.errorHandler.createErrorContext(
      'HealthCheckService',
      'runHealthChecks',
      { startTime }
    );

    // Create an array of observables for each health check
    const healthChecks = this.components.map(component => {
      return component.check().pipe(
        catchError(error => {
          // Handle errors in health checks
          const result: HealthCheckResult = {
            component: component.name,
            status: HealthStatus.UNHEALTHY,
            details: { error: error.message || 'Unknown error' },
            timestamp: new Date()
          };
          return of(result);
        })
      );
    });

    // If there are no health checks, return unknown status
    if (healthChecks.length === 0) {
      const health: SystemHealth = {
        status: HealthStatus.UNKNOWN,
        components: [],
        timestamp: new Date()
      };
      this.healthSubject.next(health);
      return of(health);
    }

    // Run all health checks in parallel
    return this.errorHandler.handleErrorFor(
      // Use forkJoin to run all health checks in parallel
      // Since we're handling errors in each health check, forkJoin will complete
      // even if some health checks fail
      of(healthChecks).pipe(
        switchMap(checks => {
          // Execute all checks and collect results
          return Promise.all(checks.map(check => check.toPromise()));
        }),
        map(results => {
          // Calculate overall system health
          const health: SystemHealth = {
            status: this.calculateOverallStatus(results),
            components: results,
            timestamp: new Date()
          };

          // Update health subject
          this.healthSubject.next(health);

          // Log health status
          console.log(`System health: ${health.status}`);

          return health;
        })
      ),
      context
    );
  }

  /**
   * Register a custom health check
   * @param name Component name
   * @param check Health check function
   * @param critical Whether the component is critical for system operation
   */
  registerHealthCheck(
    name: string,
    check: () => Observable<HealthCheckResult>,
    critical: boolean = false
  ): void {
    this.components.push({ name, check, critical });
  }

  /**
   * Calculate overall system status based on component statuses
   * @param results Health check results
   * @returns Overall system status
   */
  private calculateOverallStatus(results: HealthCheckResult[]): HealthStatus {
    // If any critical component is unhealthy, the system is unhealthy
    const criticalComponents = this.components.filter(c => c.critical);
    const criticalResults = results.filter(r =>
      criticalComponents.some(c => c.name === r.component)
    );

    if (criticalResults.some(r => r.status === HealthStatus.UNHEALTHY)) {
      return HealthStatus.UNHEALTHY;
    }

    // If any component is unhealthy, the system is degraded
    if (results.some(r => r.status === HealthStatus.UNHEALTHY)) {
      return HealthStatus.DEGRADED;
    }

    // If any component is degraded, the system is degraded
    if (results.some(r => r.status === HealthStatus.DEGRADED)) {
      return HealthStatus.DEGRADED;
    }

    // If all components are healthy, the system is healthy
    if (results.every(r => r.status === HealthStatus.HEALTHY)) {
      return HealthStatus.HEALTHY;
    }

    // Default to unknown
    return HealthStatus.UNKNOWN;
  }

  /**
   * Register database health check
   */
  private registerDatabaseHealthCheck(): void {
    this.registerHealthCheck(
      'database',
      () => {
        const startTime = Date.now();

        return from(this.electronWindowService.getDatabasePath()).pipe(
          switchMap((result: any) => {
            if (!result.success) {
              return of({
                component: 'database',
                status: HealthStatus.UNHEALTHY,
                details: { error: result.error || 'Could not get database path' },
                timestamp: new Date(),
                responseTime: Date.now() - startTime
              });
            }

            // If we got the database path, the database is accessible
            return of({
              component: 'database',
              status: HealthStatus.HEALTHY,
              details: { path: result.path },
              timestamp: new Date(),
              responseTime: Date.now() - startTime
            });
          }),
          catchError(error => {
            return of({
              component: 'database',
              status: HealthStatus.UNHEALTHY,
              details: { error: error.message || 'Unknown error' },
              timestamp: new Date(),
              responseTime: Date.now() - startTime
            });
          })
        );
      },
      true // Database is critical
    );
  }

  /**
   * Register Electron health check
   */
  private registerElectronHealthCheck(): void {
    this.registerHealthCheck(
      'electron',
      () => {
        const startTime = Date.now();

        // Check if Electron is available by calling a simple IPC method
        return from(this.electronWindowService.isMaximized()).pipe(
          map((isMaximized: boolean) => {
            return {
              component: 'electron',
              status: HealthStatus.HEALTHY,
              details: { isMaximized },
              timestamp: new Date(),
              responseTime: Date.now() - startTime
            };
          }),
          catchError(error => {
            return of({
              component: 'electron',
              status: HealthStatus.UNHEALTHY,
              details: { error: error.message || 'Unknown error' },
              timestamp: new Date(),
              responseTime: Date.now() - startTime
            });
          })
        );
      },
      true // Electron is critical
    );
  }

  /**
   * Register file system health check
   */
  private registerFileSystemHealthCheck(): void {
    this.registerHealthCheck(
      'fileSystem',
      () => {
        const startTime = Date.now();

        // Check if file system is accessible by showing an open dialog
        // but cancelling it immediately
        const options = {
          properties: ['openDirectory'],
          defaultPath: '.',
          title: 'Health Check (Cancel This)',
          buttonLabel: 'Cancel'
        };

        return from(this.electronWindowService.showOpenDialog(options)).pipe(
          map((result: any) => {
            // If we can show the dialog, the file system is accessible
            // (even if the user cancels it)
            return {
              component: 'fileSystem',
              status: HealthStatus.HEALTHY,
              details: { dialogShown: true },
              timestamp: new Date(),
              responseTime: Date.now() - startTime
            };
          }),
          catchError(error => {
            return of({
              component: 'fileSystem',
              status: HealthStatus.UNHEALTHY,
              details: { error: error.message || 'Unknown error' },
              timestamp: new Date(),
              responseTime: Date.now() - startTime
            });
          })
        );
      },
      true // File system is critical
    );
  }
}
