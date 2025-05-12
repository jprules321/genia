import { Component, OnInit } from '@angular/core';
import { ElectronWindowService } from '../../providers/electron-window.service';

@Component({
  selector: 'app-ipc-example',
  template: `
    <div class="container">
      <h2>Enhanced IPC Communication Example</h2>

      <div class="card mb-4">
        <div class="card-header">
          <h3>Service Registry</h3>
        </div>
        <div class="card-body">
          <button class="btn btn-primary me-2" (click)="listServices()">List Services</button>
          <button class="btn btn-info me-2" (click)="getSystemInfo()">Get System Info</button>
          <button class="btn btn-success me-2" (click)="listDirectory()">List Directory</button>
          <button class="btn btn-warning" (click)="getDatabaseStats()">Database Stats</button>

          <div class="mt-3" *ngIf="serviceResult">
            <h4>Result:</h4>
            <pre class="bg-light p-3">{{ serviceResult | json }}</pre>
          </div>
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-header">
          <h3>Compression</h3>
        </div>
        <div class="card-body">
          <button class="btn btn-primary me-2" (click)="sendLargePayload()">Send Large Payload</button>
          <div class="mt-3" *ngIf="compressionResult">
            <h4>Result:</h4>
            <pre class="bg-light p-3">{{ compressionResult | json }}</pre>
          </div>
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-header">
          <h3>Batch Processing</h3>
        </div>
        <div class="card-body">
          <button class="btn btn-primary me-2" (click)="sendBatchRequest()">Send Batch Request</button>
          <div class="mt-3" *ngIf="batchResult">
            <h4>Result:</h4>
            <pre class="bg-light p-3">{{ batchResult | json }}</pre>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .container {
      padding: 20px;
    }
    pre {
      max-height: 300px;
      overflow: auto;
    }
  `]
})
export class IpcExampleComponent implements OnInit {
  serviceResult: any;
  compressionResult: any;
  batchResult: any;

  constructor(private electronService: ElectronWindowService) { }

  ngOnInit(): void {
    // You could initialize data here
  }

  async listServices(): Promise<void> {
    try {
      const result = await this.electronService.listServices();
      this.serviceResult = result;
    } catch (error) {
      console.error('Error listing services:', error);
      this.serviceResult = { error: 'Failed to list services' };
    }
  }

  async getSystemInfo(): Promise<void> {
    try {
      const result = await this.electronService.invokeServiceMethod(
        'systemInfo',
        'getAppVersion'
      );

      // Get more system info
      const platform = await this.electronService.invokeServiceMethod(
        'systemInfo',
        'getPlatform'
      );

      const memory = await this.electronService.invokeServiceMethod(
        'systemInfo',
        'getMemoryUsage'
      );

      this.serviceResult = {
        appVersion: result.result,
        platform: platform.result,
        memory: memory.result
      };
    } catch (error) {
      console.error('Error getting system info:', error);
      this.serviceResult = { error: 'Failed to get system info' };
    }
  }

  async listDirectory(): Promise<void> {
    try {
      // Get app directory
      const appPath = await this.electronService.getDatabasePath();
      const appDir = appPath.directory;

      const result = await this.electronService.invokeServiceMethod(
        'fileSystem',
        'listDirectory',
        [appDir]
      );

      this.serviceResult = result.result;
    } catch (error) {
      console.error('Error listing directory:', error);
      this.serviceResult = { error: 'Failed to list directory' };
    }
  }

  async getDatabaseStats(): Promise<void> {
    try {
      const result = await this.electronService.invokeServiceMethod(
        'database',
        'getStats'
      );

      this.serviceResult = result.result;
    } catch (error) {
      console.error('Error getting database stats:', error);
      this.serviceResult = { error: 'Failed to get database stats' };
    }
  }

  async sendLargePayload(): Promise<void> {
    try {
      // Create a large payload that will trigger compression
      const largePayload = {
        data: Array(10000).fill('This is a test string that will be repeated many times to create a large payload')
      };

      // Send the large payload using the enhanced IPC
      const result = await this.electronService.sendRequest({
        id: 'large-payload-test',
        channel: 'echo',
        payload: largePayload
      });

      this.compressionResult = {
        success: result.success,
        message: 'Large payload sent and received successfully',
        payloadSize: JSON.stringify(largePayload).length,
        // The actual payload is too large to display
        sampleData: largePayload.data.slice(0, 3)
      };
    } catch (error) {
      console.error('Error sending large payload:', error);
      this.compressionResult = { error: 'Failed to send large payload' };
    }
  }

  async sendBatchRequest(): Promise<void> {
    try {
      // Create a batch request with multiple operations
      const result = await this.electronService.sendBatchRequest({
        id: 'batch-test',
        channel: 'echo',
        payloads: [
          { message: 'Batch item 1' },
          { message: 'Batch item 2' },
          { message: 'Batch item 3' }
        ]
      });

      this.batchResult = result;
    } catch (error) {
      console.error('Error sending batch request:', error);
      this.batchResult = { error: 'Failed to send batch request' };
    }
  }
}
