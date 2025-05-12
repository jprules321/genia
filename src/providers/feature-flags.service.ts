import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { map, catchError } from 'rxjs/operators';
import { ErrorHandlerService } from './error-handler.service';

// Feature flag interface
export interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  enabledForUsers?: string[];
  enabledForGroups?: string[];
  rolloutPercentage?: number;
  dependencies?: string[];
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Feature flags configuration interface
export interface FeatureFlagsConfig {
  flags: FeatureFlag[];
  source: 'local' | 'remote';
  lastUpdated: Date;
}

@Injectable({
  providedIn: 'root'
})
export class FeatureFlagsService {
  // Storage key for feature flags
  private readonly STORAGE_KEY = 'genia_feature_flags';

  // Default feature flags
  private readonly DEFAULT_FLAGS: FeatureFlag[] = [
    {
      id: 'enhanced-error-handling',
      name: 'Enhanced Error Handling',
      description: 'Enables enhanced error handling with retry mechanisms and circuit breakers',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'health-checks',
      name: 'Health Checks',
      description: 'Enables system health checks for critical components',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'telemetry',
      name: 'Telemetry',
      description: 'Enables application telemetry for proactive issue detection',
      enabled: false,
      rolloutPercentage: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'self-healing',
      name: 'Self-Healing',
      description: 'Enables self-healing mechanisms for common failure scenarios',
      enabled: false,
      dependencies: ['enhanced-error-handling', 'health-checks'],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'chaos-testing',
      name: 'Chaos Testing',
      description: 'Enables chaos testing to identify reliability issues',
      enabled: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ];

  // Feature flags subject
  private flagsSubject = new BehaviorSubject<FeatureFlagsConfig>({
    flags: this.DEFAULT_FLAGS,
    source: 'local',
    lastUpdated: new Date()
  });

  // Current user ID (for user-specific flags)
  private currentUserId: string | null = null;

  // Current user groups (for group-specific flags)
  private currentUserGroups: string[] = [];

  // Random user value for percentage-based rollouts (0-100)
  private userRolloutValue: number = Math.floor(Math.random() * 100);

  constructor(
    private http: HttpClient,
    private errorHandler: ErrorHandlerService
  ) {
    // Load feature flags from storage
    this.loadFlags();
  }

  /**
   * Get all feature flags
   * @returns Observable of feature flags configuration
   */
  getFlags(): Observable<FeatureFlagsConfig> {
    return this.flagsSubject.asObservable();
  }

  /**
   * Check if a feature is enabled
   * @param featureId The feature ID to check
   * @returns Observable of boolean indicating if the feature is enabled
   */
  isEnabled(featureId: string): Observable<boolean> {
    return this.flagsSubject.pipe(
      map(config => {
        const flag = config.flags.find(f => f.id === featureId);
        if (!flag) {
          return false;
        }

        return this.isFeatureEnabledForCurrentUser(flag);
      })
    );
  }

  /**
   * Check if a feature is enabled (synchronous version)
   * @param featureId The feature ID to check
   * @returns Boolean indicating if the feature is enabled
   */
  isEnabledSync(featureId: string): boolean {
    const config = this.flagsSubject.getValue();
    const flag = config.flags.find(f => f.id === featureId);
    if (!flag) {
      return false;
    }

    return this.isFeatureEnabledForCurrentUser(flag);
  }

  /**
   * Set the current user ID and groups
   * @param userId The current user ID
   * @param groups The current user groups
   */
  setCurrentUser(userId: string | null, groups: string[] = []): void {
    this.currentUserId = userId;
    this.currentUserGroups = groups;

    // Notify subscribers that user context has changed
    // (this may affect which features are enabled)
    this.flagsSubject.next(this.flagsSubject.getValue());
  }

  /**
   * Enable a feature
   * @param featureId The feature ID to enable
   * @returns Observable of boolean indicating success
   */
  enableFeature(featureId: string): Observable<boolean> {
    return this.updateFeatureStatus(featureId, true);
  }

  /**
   * Disable a feature
   * @param featureId The feature ID to disable
   * @returns Observable of boolean indicating success
   */
  disableFeature(featureId: string): Observable<boolean> {
    return this.updateFeatureStatus(featureId, false);
  }

  /**
   * Update a feature flag
   * @param flag The updated feature flag
   * @returns Observable of boolean indicating success
   */
  updateFeature(flag: FeatureFlag): Observable<boolean> {
    const context = this.errorHandler.createErrorContext(
      'FeatureFlagsService',
      'updateFeature',
      { featureId: flag.id }
    );

    return this.errorHandler.handleErrorFor(
      new Observable<boolean>(observer => {
        const config = this.flagsSubject.getValue();
        const index = config.flags.findIndex(f => f.id === flag.id);

        if (index === -1) {
          observer.error(new Error(`Feature flag with ID ${flag.id} not found`));
          return;
        }

        // Update the flag
        flag.updatedAt = new Date();
        config.flags[index] = flag;
        config.lastUpdated = new Date();

        // Save to storage
        this.saveFlags(config);

        // Notify subscribers
        this.flagsSubject.next(config);

        observer.next(true);
        observer.complete();
      }),
      context
    );
  }

  /**
   * Add a new feature flag
   * @param flag The new feature flag
   * @returns Observable of boolean indicating success
   */
  addFeature(flag: Partial<FeatureFlag>): Observable<boolean> {
    const context = this.errorHandler.createErrorContext(
      'FeatureFlagsService',
      'addFeature',
      { featureId: flag.id }
    );

    return this.errorHandler.handleErrorFor(
      new Observable<boolean>(observer => {
        const config = this.flagsSubject.getValue();

        // Check if flag with this ID already exists
        if (config.flags.some(f => f.id === flag.id)) {
          observer.error(new Error(`Feature flag with ID ${flag.id} already exists`));
          return;
        }

        // Create a new flag with defaults
        const newFlag: FeatureFlag = {
          id: flag.id || `feature-${Date.now()}`,
          name: flag.name || flag.id || 'New Feature',
          description: flag.description || '',
          enabled: flag.enabled !== undefined ? flag.enabled : false,
          enabledForUsers: flag.enabledForUsers || [],
          enabledForGroups: flag.enabledForGroups || [],
          rolloutPercentage: flag.rolloutPercentage,
          dependencies: flag.dependencies || [],
          expiresAt: flag.expiresAt,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Add the flag
        config.flags.push(newFlag);
        config.lastUpdated = new Date();

        // Save to storage
        this.saveFlags(config);

        // Notify subscribers
        this.flagsSubject.next(config);

        observer.next(true);
        observer.complete();
      }),
      context
    );
  }

  /**
   * Remove a feature flag
   * @param featureId The feature ID to remove
   * @returns Observable of boolean indicating success
   */
  removeFeature(featureId: string): Observable<boolean> {
    const context = this.errorHandler.createErrorContext(
      'FeatureFlagsService',
      'removeFeature',
      { featureId }
    );

    return this.errorHandler.handleErrorFor(
      new Observable<boolean>(observer => {
        const config = this.flagsSubject.getValue();
        const index = config.flags.findIndex(f => f.id === featureId);

        if (index === -1) {
          observer.error(new Error(`Feature flag with ID ${featureId} not found`));
          return;
        }

        // Remove the flag
        config.flags.splice(index, 1);
        config.lastUpdated = new Date();

        // Save to storage
        this.saveFlags(config);

        // Notify subscribers
        this.flagsSubject.next(config);

        observer.next(true);
        observer.complete();
      }),
      context
    );
  }

  /**
   * Fetch feature flags from a remote source
   * @param url The URL to fetch flags from
   * @returns Observable of boolean indicating success
   */
  fetchRemoteFlags(url: string): Observable<boolean> {
    const context = this.errorHandler.createErrorContext(
      'FeatureFlagsService',
      'fetchRemoteFlags',
      { url }
    );

    return this.errorHandler.handleErrorFor(
      this.http.get<FeatureFlag[]>(url).pipe(
        map(flags => {
          const config: FeatureFlagsConfig = {
            flags,
            source: 'remote',
            lastUpdated: new Date()
          };

          // Save to storage
          this.saveFlags(config);

          // Notify subscribers
          this.flagsSubject.next(config);

          return true;
        }),
        catchError(error => {
          console.error('Error fetching remote feature flags:', error);
          throw error;
        })
      ),
      context
    );
  }

  /**
   * Reset feature flags to defaults
   * @returns Observable of boolean indicating success
   */
  resetToDefaults(): Observable<boolean> {
    const context = this.errorHandler.createErrorContext(
      'FeatureFlagsService',
      'resetToDefaults'
    );

    return this.errorHandler.handleErrorFor(
      new Observable<boolean>(observer => {
        const config: FeatureFlagsConfig = {
          flags: this.DEFAULT_FLAGS,
          source: 'local',
          lastUpdated: new Date()
        };

        // Save to storage
        this.saveFlags(config);

        // Notify subscribers
        this.flagsSubject.next(config);

        observer.next(true);
        observer.complete();
      }),
      context
    );
  }

  /**
   * Update a feature's enabled status
   * @param featureId The feature ID to update
   * @param enabled The new enabled status
   * @returns Observable of boolean indicating success
   */
  private updateFeatureStatus(featureId: string, enabled: boolean): Observable<boolean> {
    const context = this.errorHandler.createErrorContext(
      'FeatureFlagsService',
      'updateFeatureStatus',
      { featureId, enabled }
    );

    return this.errorHandler.handleErrorFor(
      new Observable<boolean>(observer => {
        const config = this.flagsSubject.getValue();
        const index = config.flags.findIndex(f => f.id === featureId);

        if (index === -1) {
          observer.error(new Error(`Feature flag with ID ${featureId} not found`));
          return;
        }

        // Update the flag
        config.flags[index].enabled = enabled;
        config.flags[index].updatedAt = new Date();
        config.lastUpdated = new Date();

        // Save to storage
        this.saveFlags(config);

        // Notify subscribers
        this.flagsSubject.next(config);

        observer.next(true);
        observer.complete();
      }),
      context
    );
  }

  /**
   * Check if a feature is enabled for the current user
   * @param flag The feature flag to check
   * @returns Boolean indicating if the feature is enabled
   */
  private isFeatureEnabledForCurrentUser(flag: FeatureFlag): boolean {
    // If the feature is not enabled globally, check if it's enabled for this user
    if (!flag.enabled) {
      // Check if enabled for this user specifically
      if (this.currentUserId && flag.enabledForUsers?.includes(this.currentUserId)) {
        return true;
      }

      // Check if enabled for any of the user's groups
      if (flag.enabledForGroups && this.currentUserGroups.some(group =>
        flag.enabledForGroups?.includes(group))) {
        return true;
      }

      // Not enabled for this user
      return false;
    }

    // Feature is enabled globally, but check if it has dependencies
    if (flag.dependencies && flag.dependencies.length > 0) {
      // All dependencies must be enabled
      for (const depId of flag.dependencies) {
        const depFlag = this.flagsSubject.getValue().flags.find(f => f.id === depId);
        if (!depFlag || !this.isFeatureEnabledForCurrentUser(depFlag)) {
          return false;
        }
      }
    }

    // Check if the feature has expired
    if (flag.expiresAt && new Date() > new Date(flag.expiresAt)) {
      return false;
    }

    // Check rollout percentage
    if (flag.rolloutPercentage !== undefined) {
      return this.userRolloutValue <= flag.rolloutPercentage;
    }

    // Feature is enabled and all checks passed
    return true;
  }

  /**
   * Load feature flags from storage
   */
  private loadFlags(): void {
    try {
      const storedFlags = localStorage.getItem(this.STORAGE_KEY);
      if (storedFlags) {
        const config = JSON.parse(storedFlags) as FeatureFlagsConfig;

        // Convert date strings to Date objects
        config.lastUpdated = new Date(config.lastUpdated);
        config.flags.forEach(flag => {
          flag.createdAt = new Date(flag.createdAt);
          flag.updatedAt = new Date(flag.updatedAt);
          if (flag.expiresAt) {
            flag.expiresAt = new Date(flag.expiresAt);
          }
        });

        this.flagsSubject.next(config);
      }
    } catch (error) {
      console.error('Error loading feature flags from storage:', error);
      // Use default flags
      this.resetToDefaults().subscribe();
    }
  }

  /**
   * Save feature flags to storage
   * @param config The feature flags configuration to save
   */
  private saveFlags(config: FeatureFlagsConfig): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(config));
    } catch (error) {
      console.error('Error saving feature flags to storage:', error);
    }
  }
}
