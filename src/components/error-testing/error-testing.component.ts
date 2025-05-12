import { Component, OnInit, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError, Subscription } from 'rxjs';
import { catchError, delay, tap } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { ButtonAllModule } from '@syncfusion/ej2-angular-buttons';
import { SwitchAllModule } from '@syncfusion/ej2-angular-buttons';
import { ErrorHandlerService, ErrorContext, ErrorCategory, ErrorSeverity } from '../../providers/error-handler.service';
import { HealthCheckService, HealthStatus } from '../../providers/health-check.service';
import { FeatureFlagsService } from '../../providers/feature-flags.service';
import { ChaosTestingService } from '../../providers/chaos-testing.service';
import { NotificationService } from '../../providers/notification.service';

@Component({
  selector: 'app-error-testing',
  templateUrl: './error-testing.component.html',
  styleUrls: ['./error-testing.component.scss'],
  standalone: true,
  imports: [CommonModule, ButtonAllModule, SwitchAllModule]
})
export class ErrorTestingComponent implements OnInit, OnDestroy {
  // System health status
  healthStatus: HealthStatus = HealthStatus.UNKNOWN;

  // Feature flags
  featureFlags: { id: string; name: string; enabled: boolean }[] = [];

  // Circuit breaker status
  circuitBreakerStatus: string = 'Unknown';

  // Subscriptions
  private subscriptions: Subscription[] = [];

  // Test service name for circuit breaker
  private readonly TEST_SERVICE = 'test-service';

  constructor(
    private http: HttpClient,
    private errorHandler: ErrorHandlerService,
    private healthCheckService: HealthCheckService,
    private featureFlagsService: FeatureFlagsService,
    private chaosTestingService: ChaosTestingService,
    private notificationService: NotificationService
  ) {}

  ngOnInit(): void {
    // Subscribe to health status updates
    this.subscriptions.push(
      this.healthCheckService.getHealth().subscribe(health => {
        this.healthStatus = health.status;
      })
    );

    // Get feature flags
    this.subscriptions.push(
      this.featureFlagsService.getFlags().subscribe(config => {
        this.featureFlags = config.flags.map(flag => ({
          id: flag.id,
          name: flag.name,
          enabled: this.featureFlagsService.isEnabledSync(flag.id)
        }));
      })
    );

    // Create circuit breaker for test service
    this.errorHandler.createCircuitBreaker(this.TEST_SERVICE, {
      failureThreshold: 3,
      resetTimeout: 10000, // 10 seconds
      maxRetries: 2,
      retryDelay: 1000 // 1 second
    });
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  /**
   * Trigger a global error
   */
  triggerGlobalError(): void {
    // This will be caught by the global error handler
    throw new Error('This is a test error thrown from ErrorTestingComponent');
  }

  /**
   * Trigger an HTTP error
   */
  triggerHttpError(): void {
    // Make a request to a non-existent endpoint
    this.http.get('https://api.example.com/non-existent')
      .pipe(
        catchError(error => {
          // This error will be handled by the error handler service
          console.log('HTTP error caught in component:', error);
          return throwError(() => error);
        })
      )
      .subscribe({
        next: () => {},
        error: (error) => {
          console.log('HTTP error handled in component:', error);
        }
      });
  }

  /**
   * Test the retry mechanism
   */
  testRetryMechanism(): void {
    let attempts = 0;

    // Create a context for error tracking
    const context = this.errorHandler.createErrorContext(
      'ErrorTestingComponent',
      'testRetryMechanism',
      { maxAttempts: 3 }
    );

    // Create an observable that fails the first two times
    const testObservable = new Observable<string>(observer => {
      attempts++;

      if (attempts <= 2) {
        // Fail the first two attempts
        observer.error(new Error(`Test error (attempt ${attempts})`));
      } else {
        // Succeed on the third attempt
        observer.next(`Success on attempt ${attempts}`);
        observer.complete();
      }
    });

    // Execute with retry logic
    this.errorHandler.executeWithCircuitBreaker(
      this.TEST_SERVICE,
      () => testObservable,
      context
    ).subscribe({
      next: result => {
        this.notificationService.showSuccess(
          `Retry mechanism test succeeded: ${result}`,
          'Retry Test'
        );
      },
      error: error => {
        this.notificationService.showError(
          `Retry mechanism test failed: ${error.message}`,
          'Retry Test'
        );
      }
    });
  }

  /**
   * Test the circuit breaker
   */
  testCircuitBreaker(): void {
    // Create a context for error tracking
    const context = this.errorHandler.createErrorContext(
      'ErrorTestingComponent',
      'testCircuitBreaker'
    );

    // Create an observable that always fails
    const failingObservable = new Observable<string>(observer => {
      observer.error(new Error('Test circuit breaker error'));
    });

    // Execute multiple times to trigger the circuit breaker
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        this.errorHandler.executeWithCircuitBreaker(
          this.TEST_SERVICE,
          () => failingObservable,
          context
        ).subscribe({
          next: () => {},
          error: error => {
            // Check if the circuit is open
            if (error.message.includes('circuit open')) {
              this.circuitBreakerStatus = 'Open';
              this.notificationService.showWarning(
                'Circuit breaker is now open',
                'Circuit Breaker Test'
              );
            } else {
              this.circuitBreakerStatus = 'Closed';
              this.notificationService.showInfo(
                `Circuit breaker test: ${error.message}`,
                'Circuit Breaker Test'
              );
            }
          }
        });
      }, i * 1000); // Delay each call by 1 second
    }

    // After some time, try again to see if the circuit breaker resets
    setTimeout(() => {
      this.errorHandler.executeWithCircuitBreaker(
        this.TEST_SERVICE,
        () => of('Circuit reset test').pipe(delay(500)),
        context
      ).subscribe({
        next: result => {
          this.circuitBreakerStatus = 'Half-Open/Closed';
          this.notificationService.showSuccess(
            `Circuit breaker has reset: ${result}`,
            'Circuit Breaker Test'
          );
        },
        error: () => {}
      });
    }, 15000); // Wait 15 seconds (longer than the reset timeout)
  }

  /**
   * Run health checks
   */
  runHealthChecks(): void {
    this.healthCheckService.runHealthChecks().subscribe(health => {
      this.healthStatus = health.status;

      this.notificationService.showInfo(
        `Health check completed: ${health.status}`,
        'Health Check'
      );

      // Log detailed results
      console.log('Health check results:', health);
    });
  }

  /**
   * Toggle a feature flag
   * @param featureId The feature ID to toggle
   */
  toggleFeatureFlag(featureId: string): void {
    const isEnabled = this.featureFlagsService.isEnabledSync(featureId);

    if (isEnabled) {
      this.featureFlagsService.disableFeature(featureId).subscribe(() => {
        this.updateFeatureFlagsList();
        this.notificationService.showInfo(
          `Feature '${featureId}' disabled`,
          'Feature Flags'
        );
      });
    } else {
      this.featureFlagsService.enableFeature(featureId).subscribe(() => {
        this.updateFeatureFlagsList();
        this.notificationService.showInfo(
          `Feature '${featureId}' enabled`,
          'Feature Flags'
        );
      });
    }
  }

  /**
   * Test chaos testing
   */
  testChaos(): void {
    // Enable chaos testing feature flag
    this.featureFlagsService.enableFeature('chaos-testing').subscribe(() => {
      this.updateFeatureFlagsList();

      // Enable network latency chaos event
      this.chaosTestingService.enableEvent('network-latency');

      // Create a test observable with chaos
      const testObservable = of('Chaos test result').pipe(
        delay(500), // Base delay
        tap(() => console.log('Observable executing...'))
      );

      // Apply chaos to the observable
      this.chaosTestingService.applyNetworkChaos('test', testObservable)
        .subscribe({
          next: result => {
            this.notificationService.showInfo(
              `Chaos test completed: ${result}`,
              'Chaos Test'
            );
          },
          error: error => {
            this.notificationService.showError(
              `Chaos test error: ${error.message}`,
              'Chaos Test'
            );
          }
        });

      // Test memory leak simulation
      this.chaosTestingService.simulateMemoryLeak(1, 5000); // 1MB for 5 seconds

      // Disable chaos testing after the test
      setTimeout(() => {
        this.chaosTestingService.disableEvent('network-latency');
        this.featureFlagsService.disableFeature('chaos-testing').subscribe(() => {
          this.updateFeatureFlagsList();
        });
      }, 10000); // Disable after 10 seconds
    });
  }

  /**
   * Update the feature flags list
   */
  private updateFeatureFlagsList(): void {
    this.featureFlags = this.featureFlags.map(flag => ({
      ...flag,
      enabled: this.featureFlagsService.isEnabledSync(flag.id)
    }));
  }

  /**
   * Get CSS class for health status
   */
  getHealthStatusClass(): string {
    switch (this.healthStatus) {
      case HealthStatus.HEALTHY:
        return 'status-healthy';
      case HealthStatus.DEGRADED:
        return 'status-degraded';
      case HealthStatus.UNHEALTHY:
        return 'status-unhealthy';
      default:
        return 'status-unknown';
    }
  }
}
