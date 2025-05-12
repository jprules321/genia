import { Injectable, ErrorHandler, Injector } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, of, timer } from 'rxjs';
import { mergeMap, finalize, catchError, retry, retryWhen, tap, delayWhen } from 'rxjs/operators';
import { NotificationService } from './notification.service';

// Error severity levels
export enum ErrorSeverity {
  FATAL = 'fatal',    // Application cannot continue, requires restart
  ERROR = 'error',    // Operation failed, but application can continue
  WARNING = 'warning', // Operation succeeded with issues
  INFO = 'info'       // Informational only
}

// Error categories
export enum ErrorCategory {
  NETWORK = 'network',
  DATABASE = 'database',
  FILE_SYSTEM = 'file_system',
  PERMISSION = 'permission',
  VALIDATION = 'validation',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled',
  ELECTRON = 'electron',
  PARSE = 'parse',
  UNKNOWN = 'unknown'
}

// Error context interface
export interface ErrorContext {
  component?: string;
  method?: string;
  params?: any;
  user?: string;
  timestamp?: Date;
  additionalInfo?: any;
}

// Standardized error object
export interface AppError {
  message: string;
  userMessage: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  originalError?: any;
  stack?: string;
  context?: ErrorContext;
}

// Circuit breaker states
export enum CircuitState {
  CLOSED = 'closed',   // Normal operation, requests pass through
  OPEN = 'open',       // Circuit is open, requests fail fast
  HALF_OPEN = 'half-open' // Testing if service is back online
}

// Circuit breaker configuration
export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  maxRetries: number;
  retryDelay: number;
}

// Default circuit breaker configuration
const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeout: 30000, // 30 seconds
  maxRetries: 3,
  retryDelay: 1000 // 1 second
};

@Injectable({
  providedIn: 'root'
})
export class ErrorHandlerService implements ErrorHandler {
  private circuitBreakers: Map<string, {
    state: CircuitState;
    failures: number;
    lastFailure: number;
    config: CircuitBreakerConfig;
  }> = new Map();

  constructor(private injector: Injector) {}

  /**
   * Global error handler for uncaught exceptions
   * @param error The error object
   */
  handleError(error: any): void {
    const appError = this.normalizeError(error);

    // Log the error
    this.logError(appError);

    // Display user-friendly message if appropriate
    if (appError.severity === ErrorSeverity.FATAL || appError.severity === ErrorSeverity.ERROR) {
      this.showErrorToUser(appError);
    }
  }

  /**
   * Normalize different error types into a standard AppError object
   * @param error The original error
   * @param context Optional context information
   * @returns Standardized AppError object
   */
  normalizeError(error: any, context?: ErrorContext): AppError {
    // Default values
    let message = 'An unknown error occurred';
    let userMessage = 'Something went wrong. Please try again later.';
    let severity = ErrorSeverity.ERROR;
    let category = ErrorCategory.UNKNOWN;
    let stack = '';

    // Enhance context with timestamp if not provided
    const enhancedContext: ErrorContext = {
      ...context,
      timestamp: context?.timestamp || new Date()
    };

    // Handle different error types
    if (error instanceof HttpErrorResponse) {
      // HTTP errors
      message = `HTTP Error: ${error.status} ${error.statusText}`;
      userMessage = this.getUserMessageForHttpError(error);
      severity = this.getSeverityForHttpError(error);
      category = ErrorCategory.NETWORK;
      stack = error.error?.stack || '';
    } else if (error instanceof Error) {
      // Standard JS errors
      message = error.message || 'Error';
      userMessage = this.getUserMessageForError(error);
      severity = ErrorSeverity.ERROR;
      category = this.categorizeError(error);
      stack = error.stack || '';
    } else if (typeof error === 'string') {
      // String errors
      message = error;
      userMessage = this.simplifyErrorMessage(error);
    } else if (error && typeof error === 'object') {
      // Object errors
      message = error.message || 'Object error';
      userMessage = error.userMessage || this.simplifyErrorMessage(error.message);
      severity = error.severity || ErrorSeverity.ERROR;
      category = error.category || this.categorizeError(error);
      stack = error.stack || '';
    }

    return {
      message,
      userMessage,
      severity,
      category,
      originalError: error,
      stack,
      context: enhancedContext
    };
  }

  /**
   * Log error with all available context
   * @param error The AppError object
   */
  private logError(error: AppError): void {
    // Create a structured log entry
    const logEntry = {
      timestamp: error.context?.timestamp || new Date(),
      severity: error.severity,
      category: error.category,
      message: error.message,
      component: error.context?.component || 'unknown',
      method: error.context?.method || 'unknown',
      stack: error.stack,
      additionalInfo: error.context?.additionalInfo
    };

    // Log to console (in production, this would go to a logging service)
    if (error.severity === ErrorSeverity.FATAL) {
      console.error('FATAL ERROR:', logEntry);
    } else if (error.severity === ErrorSeverity.ERROR) {
      console.error('ERROR:', logEntry);
    } else if (error.severity === ErrorSeverity.WARNING) {
      console.warn('WARNING:', logEntry);
    } else {
      console.info('INFO:', logEntry);
    }

    // In a real application, we would send this to a logging service
    // this.loggingService.logError(logEntry);
  }

  /**
   * Display user-friendly error message
   * @param error The AppError object
   */
  private showErrorToUser(error: AppError): void {
    // Get the notification service from the injector
    const notificationService = this.injector.get(NotificationService);

    // Show the error notification with appropriate duration based on severity
    if (error.severity === ErrorSeverity.FATAL) {
      // Fatal errors stay until dismissed
      notificationService.showError(error.userMessage, 'Critical Error', undefined);
    } else if (error.severity === ErrorSeverity.ERROR) {
      // Regular errors stay for 10 seconds
      notificationService.showError(error.userMessage, 'Error', 10000);
    } else if (error.severity === ErrorSeverity.WARNING) {
      // Warnings stay for 7 seconds
      notificationService.showWarning(error.userMessage, 'Warning', 7000);
    } else {
      // Info messages stay for 5 seconds (default)
      notificationService.showInfo(error.userMessage);
    }

    // Also log to console for development purposes
    console.log('USER MESSAGE:', error.userMessage);
  }

  /**
   * Categorize an error based on its type and message
   * @param error The error object
   * @returns The error category
   */
  private categorizeError(error: any): ErrorCategory {
    const errorString = error.message || error.toString();

    if (errorString.includes('network') ||
        errorString.includes('http') ||
        errorString.includes('connection')) {
      return ErrorCategory.NETWORK;
    }

    if (errorString.includes('permission') ||
        errorString.includes('access denied') ||
        errorString.includes('EACCES')) {
      return ErrorCategory.PERMISSION;
    }

    if (errorString.includes('database') ||
        errorString.includes('sql') ||
        errorString.includes('query')) {
      return ErrorCategory.DATABASE;
    }

    if (errorString.includes('file') ||
        errorString.includes('directory') ||
        errorString.includes('ENOENT') ||
        errorString.includes('EISDIR')) {
      return ErrorCategory.FILE_SYSTEM;
    }

    if (errorString.includes('timeout') ||
        errorString.includes('timed out')) {
      return ErrorCategory.TIMEOUT;
    }

    if (errorString.includes('cancelled') ||
        errorString.includes('canceled') ||
        errorString.includes('abort')) {
      return ErrorCategory.CANCELLED;
    }

    if (errorString.includes('electron') ||
        errorString.includes('ipc')) {
      return ErrorCategory.ELECTRON;
    }

    if (errorString.includes('parse') ||
        errorString.includes('backend')) {
      return ErrorCategory.PARSE;
    }

    if (errorString.includes('validation') ||
        errorString.includes('invalid')) {
      return ErrorCategory.VALIDATION;
    }

    return ErrorCategory.UNKNOWN;
  }

  /**
   * Get user-friendly message for HTTP errors
   * @param error The HTTP error response
   * @returns User-friendly error message
   */
  private getUserMessageForHttpError(error: HttpErrorResponse): string {
    switch (error.status) {
      case 0:
        return 'Cannot connect to the server. Please check your internet connection.';
      case 400:
        return 'The request was invalid. Please check your input and try again.';
      case 401:
        return 'You need to log in to access this feature.';
      case 403:
        return 'You do not have permission to access this feature.';
      case 404:
        return 'The requested resource was not found.';
      case 408:
        return 'The request timed out. Please try again later.';
      case 500:
        return 'The server encountered an error. Please try again later.';
      case 503:
        return 'The service is temporarily unavailable. Please try again later.';
      default:
        return `An error occurred (${error.status}). Please try again later.`;
    }
  }

  /**
   * Get severity level for HTTP errors
   * @param error The HTTP error response
   * @returns Error severity level
   */
  private getSeverityForHttpError(error: HttpErrorResponse): ErrorSeverity {
    if (error.status === 0 || error.status >= 500) {
      return ErrorSeverity.ERROR;
    } else if (error.status === 401 || error.status === 403) {
      return ErrorSeverity.WARNING;
    } else {
      return ErrorSeverity.ERROR;
    }
  }

  /**
   * Get user-friendly message for standard errors
   * @param error The error object
   * @returns User-friendly error message
   */
  private getUserMessageForError(error: Error): string {
    // Extract the error name for specific handling
    const errorName = error.name || '';
    const errorMessage = error.message || '';

    // Handle specific error types
    if (errorName === 'TypeError') {
      return 'An unexpected error occurred in the application.';
    } else if (errorName === 'ReferenceError') {
      return 'An unexpected error occurred in the application.';
    } else if (errorName === 'SyntaxError') {
      return 'There was a problem with the application data.';
    } else if (errorMessage.includes('permission')) {
      return 'You do not have permission to perform this action.';
    } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
      return 'There was a problem connecting to the server. Please check your internet connection.';
    } else if (errorMessage.includes('timeout')) {
      return 'The operation timed out. Please try again later.';
    } else if (errorMessage.includes('file') || errorMessage.includes('directory')) {
      return 'There was a problem accessing a file or directory.';
    } else if (errorMessage.includes('database')) {
      return 'There was a problem with the database. Please try again later.';
    }

    // Default message
    return this.simplifyErrorMessage(errorMessage);
  }

  /**
   * Convert technical error messages to user-friendly ones
   * @param message The original error message
   * @returns Simplified user-friendly message
   */
  private simplifyErrorMessage(message: string): string {
    if (!message) {
      return 'An unknown error occurred. Please try again later.';
    }

    // Remove technical details
    let simplified = message
      .replace(/Error: /g, '')
      .replace(/Exception: /g, '')
      .replace(/at .+:\d+:\d+/g, '')
      .replace(/\(.+\)/g, '')
      .trim();

    // If the message is too technical or too long, use a generic message
    if (simplified.length > 100 || /[{}[\]\\\/\-_+=<>]/.test(simplified)) {
      return 'An error occurred. Please try again later.';
    }

    return simplified;
  }

  /**
   * Create a circuit breaker for a specific service
   * @param serviceKey Unique identifier for the service
   * @param config Optional circuit breaker configuration
   */
  createCircuitBreaker(serviceKey: string, config?: Partial<CircuitBreakerConfig>): void {
    const fullConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };

    this.circuitBreakers.set(serviceKey, {
      state: CircuitState.CLOSED,
      failures: 0,
      lastFailure: 0,
      config: fullConfig
    });
  }

  /**
   * Execute a function with circuit breaker protection
   * @param serviceKey Unique identifier for the service
   * @param operation The operation to execute
   * @param context Optional error context
   * @returns Observable of the operation result
   */
  executeWithCircuitBreaker<T>(
    serviceKey: string,
    operation: () => Observable<T>,
    context?: ErrorContext
  ): Observable<T> {
    // Get or create circuit breaker for this service
    if (!this.circuitBreakers.has(serviceKey)) {
      this.createCircuitBreaker(serviceKey);
    }

    const circuitBreaker = this.circuitBreakers.get(serviceKey)!;

    // Check if circuit is open
    if (circuitBreaker.state === CircuitState.OPEN) {
      const now = Date.now();
      const resetTimeout = circuitBreaker.config.resetTimeout;

      // Check if it's time to try again
      if (now - circuitBreaker.lastFailure > resetTimeout) {
        // Transition to half-open state
        circuitBreaker.state = CircuitState.HALF_OPEN;
      } else {
        // Circuit is open, fail fast
        const error = this.normalizeError(
          new Error(`Service ${serviceKey} is unavailable (circuit open)`),
          context
        );
        this.logError(error);
        return throwError(() => error);
      }
    }

    // Execute the operation with retry logic
    return operation().pipe(
      // If successful and in half-open state, close the circuit
      tap(() => {
        if (circuitBreaker.state === CircuitState.HALF_OPEN) {
          circuitBreaker.state = CircuitState.CLOSED;
          circuitBreaker.failures = 0;
        }
      }),
      // Handle errors
      catchError(error => {
        // Normalize the error
        const appError = this.normalizeError(error, context);

        // Log the error
        this.logError(appError);

        // Update circuit breaker state
        circuitBreaker.failures++;
        circuitBreaker.lastFailure = Date.now();

        // If we've reached the failure threshold, open the circuit
        if (circuitBreaker.failures >= circuitBreaker.config.failureThreshold) {
          circuitBreaker.state = CircuitState.OPEN;
        }

        // Rethrow the error
        return throwError(() => appError);
      }),
      // Implement retry with exponential backoff for retryable errors
      retryWhen(errors =>
        errors.pipe(
          // Only retry for certain error categories
          mergeMap((error: AppError, attempt) => {
            const retryableCategories = [
              ErrorCategory.NETWORK,
              ErrorCategory.TIMEOUT,
              ErrorCategory.DATABASE
            ];

            // Don't retry if we've reached max retries or error isn't retryable
            if (attempt >= circuitBreaker.config.maxRetries ||
                !retryableCategories.includes(error.category)) {
              return throwError(() => error);
            }

            // Calculate delay with exponential backoff
            const delay = circuitBreaker.config.retryDelay * Math.pow(2, attempt);
            console.log(`Retrying ${serviceKey} operation in ${delay}ms (attempt ${attempt + 1})`);

            // Delay and retry
            return timer(delay);
          })
        )
      )
    );
  }

  /**
   * Wrap an observable with standardized error handling
   * @param source The source observable
   * @param context Optional error context
   * @returns Observable with error handling
   */
  handleErrorFor<T>(source: Observable<T>, context?: ErrorContext): Observable<T> {
    return source.pipe(
      catchError(error => {
        const appError = this.normalizeError(error, context);
        this.logError(appError);
        return throwError(() => appError);
      })
    );
  }

  /**
   * Create a context object for error tracking
   * @param component Component name
   * @param method Method name
   * @param additionalInfo Any additional context information
   * @returns Error context object
   */
  createErrorContext(component: string, method: string, additionalInfo?: any): ErrorContext {
    return {
      component,
      method,
      timestamp: new Date(),
      additionalInfo
    };
  }
}
