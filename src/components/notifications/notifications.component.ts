import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { ToastAllModule } from '@syncfusion/ej2-angular-notifications';
import { NotificationService, Notification, NotificationType } from '../../providers/notification.service';

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.scss'],
  standalone: true,
  imports: [CommonModule, ToastAllModule]
})
export class NotificationsComponent implements OnInit, OnDestroy {
  notifications: Notification[] = [];
  private subscriptions: Subscription[] = [];

  constructor(private notificationService: NotificationService) {}

  ngOnInit(): void {
    // Subscribe to new notifications
    this.subscriptions.push(
      this.notificationService.notifications$.subscribe(notification => {
        this.addNotification(notification);
      })
    );

    // Subscribe to notification dismissals
    this.subscriptions.push(
      this.notificationService.dismissals$.subscribe(id => {
        this.removeNotification(id);
      })
    );

    // Subscribe to clear all events
    this.subscriptions.push(
      this.notificationService.clearAll$.subscribe(() => {
        this.clearAllNotifications();
      })
    );
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  /**
   * Add a notification to the list
   * @param notification The notification to add
   */
  private addNotification(notification: Notification): void {
    this.notifications.push(notification);

    // Sort notifications by timestamp (newest first)
    this.notifications.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Limit the number of notifications to prevent UI clutter
    if (this.notifications.length > 5) {
      // Remove the oldest notification that isn't an error
      const nonErrorIndex = this.notifications.findIndex(n => n.type !== NotificationType.ERROR);
      if (nonErrorIndex !== -1) {
        this.notifications.splice(nonErrorIndex, 1);
      } else {
        // If all are errors, remove the oldest one
        this.notifications.pop();
      }
    }
  }

  /**
   * Remove a notification by ID
   * @param id The notification ID to remove
   */
  removeNotification(id: string): void {
    const index = this.notifications.findIndex(n => n.id === id);
    if (index !== -1) {
      this.notifications.splice(index, 1);
    }
  }

  /**
   * Clear all notifications
   */
  clearAllNotifications(): void {
    this.notifications = [];
  }

  /**
   * Get the CSS class for a notification type
   * @param type The notification type
   * @returns The CSS class
   */
  getNotificationClass(type: NotificationType): string {
    switch (type) {
      case NotificationType.SUCCESS:
        return 'e-success';
      case NotificationType.INFO:
        return 'e-info';
      case NotificationType.WARNING:
        return 'e-warning';
      case NotificationType.ERROR:
        return 'e-danger';
      default:
        return 'e-info';
    }
  }

  /**
   * Get the icon for a notification type
   * @param type The notification type
   * @returns The icon class
   */
  getNotificationIcon(type: NotificationType): string {
    switch (type) {
      case NotificationType.SUCCESS:
        return 'e-icons e-check-circle';
      case NotificationType.INFO:
        return 'e-icons e-info-circle';
      case NotificationType.WARNING:
        return 'e-icons e-exclamation-triangle';
      case NotificationType.ERROR:
        return 'e-icons e-exclamation-circle';
      default:
        return 'e-icons e-info-circle';
    }
  }
}
