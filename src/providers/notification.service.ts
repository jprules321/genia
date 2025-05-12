import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export enum NotificationType {
  SUCCESS = 'success',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error'
}

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  title?: string;
  duration?: number; // in milliseconds, undefined means it stays until dismissed
  dismissible?: boolean;
  timestamp: Date;
  data?: any; // Optional additional data
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private notificationSubject = new Subject<Notification>();
  private dismissSubject = new Subject<string>();
  private clearAllSubject = new Subject<void>();

  // Default notification duration in milliseconds
  private defaultDuration = 5000; // 5 seconds

  // Counter for generating unique IDs
  private idCounter = 0;

  constructor() {}

  /**
   * Get an observable of notifications
   * @returns Observable of notifications
   */
  get notifications$(): Observable<Notification> {
    return this.notificationSubject.asObservable();
  }

  /**
   * Get an observable of notification dismissals
   * @returns Observable of notification IDs being dismissed
   */
  get dismissals$(): Observable<string> {
    return this.dismissSubject.asObservable();
  }

  /**
   * Get an observable of clear all events
   * @returns Observable of clear all events
   */
  get clearAll$(): Observable<void> {
    return this.clearAllSubject.asObservable();
  }

  /**
   * Show a success notification
   * @param message The notification message
   * @param title Optional title
   * @param duration Optional duration in milliseconds
   * @param data Optional additional data
   * @returns The notification ID
   */
  showSuccess(message: string, title?: string, duration?: number, data?: any): string {
    return this.show({
      type: NotificationType.SUCCESS,
      message,
      title,
      duration: duration || this.defaultDuration,
      dismissible: true,
      data
    });
  }

  /**
   * Show an info notification
   * @param message The notification message
   * @param title Optional title
   * @param duration Optional duration in milliseconds
   * @param data Optional additional data
   * @returns The notification ID
   */
  showInfo(message: string, title?: string, duration?: number, data?: any): string {
    return this.show({
      type: NotificationType.INFO,
      message,
      title,
      duration: duration || this.defaultDuration,
      dismissible: true,
      data
    });
  }

  /**
   * Show a warning notification
   * @param message The notification message
   * @param title Optional title
   * @param duration Optional duration in milliseconds
   * @param data Optional additional data
   * @returns The notification ID
   */
  showWarning(message: string, title?: string, duration?: number, data?: any): string {
    return this.show({
      type: NotificationType.WARNING,
      message,
      title,
      duration: duration || this.defaultDuration,
      dismissible: true,
      data
    });
  }

  /**
   * Show an error notification
   * @param message The notification message
   * @param title Optional title
   * @param duration Optional duration in milliseconds (undefined means it stays until dismissed)
   * @param data Optional additional data
   * @returns The notification ID
   */
  showError(message: string, title?: string, duration?: number, data?: any): string {
    return this.show({
      type: NotificationType.ERROR,
      message,
      title: title || 'Error',
      duration: duration, // undefined means it stays until dismissed
      dismissible: true,
      data
    });
  }

  /**
   * Show a notification
   * @param options Notification options
   * @returns The notification ID
   */
  show(options: Partial<Notification>): string {
    const id = this.generateId();

    const notification: Notification = {
      id,
      type: options.type || NotificationType.INFO,
      message: options.message || '',
      title: options.title,
      duration: options.duration,
      dismissible: options.dismissible !== false, // Default to true
      timestamp: new Date(),
      data: options.data
    };

    this.notificationSubject.next(notification);

    // Auto-dismiss after duration if specified
    if (notification.duration) {
      setTimeout(() => {
        this.dismiss(id);
      }, notification.duration);
    }

    return id;
  }

  /**
   * Dismiss a notification
   * @param id The notification ID
   */
  dismiss(id: string): void {
    this.dismissSubject.next(id);
  }

  /**
   * Clear all notifications
   */
  clearAll(): void {
    this.clearAllSubject.next();
  }

  /**
   * Generate a unique notification ID
   * @returns A unique ID
   */
  private generateId(): string {
    return `notification-${Date.now()}-${this.idCounter++}`;
  }
}
