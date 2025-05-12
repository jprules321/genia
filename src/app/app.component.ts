import { Component, OnInit, ViewChild } from '@angular/core';
import { Router, NavigationEnd, RouterOutlet } from '@angular/router';
import { SidebarComponent, SidebarAllModule } from '@syncfusion/ej2-angular-navigations';
import { TextBoxAllModule } from '@syncfusion/ej2-angular-inputs';
import { TreeViewComponent, TreeViewAllModule } from '@syncfusion/ej2-angular-navigations';
import { ToolbarAllModule } from '@syncfusion/ej2-angular-navigations';
import { ToastAllModule } from '@syncfusion/ej2-angular-notifications';
import { filter } from 'rxjs/operators';
import {EstimationService} from '../providers/estimation.service';
import {ParseService} from '../providers/parse.service';
import {ElectronWindowService} from '../providers/electron-window.service';
import {IndexingService} from '../providers/indexing.service';
import {ClickEventArgs} from '@syncfusion/ej2-navigations';
import { NotificationsComponent } from '../components/notifications/notifications.component';
import { HealthCheckService } from '../providers/health-check.service';
import { FeatureFlagsService } from '../providers/feature-flags.service';

// Interface for tree node data
interface INodeData {
  nodeId: string;
  nodeText: string;
  iconCss: string;
  routerLink: string;
  nodeChild?: INodeData[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    SidebarAllModule,
    TextBoxAllModule,
    TreeViewAllModule,
    ToolbarAllModule,
    ToastAllModule,
    RouterOutlet,
    NotificationsComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  @ViewChild('sidebarTreeviewInstance') sidebarTreeviewInstance: SidebarComponent;
  @ViewChild('treeView') treeView: TreeViewComponent;

  public selectedNodes: string[] = [];
  public isMaximized = false;

  public data: INodeData[] = [
    {
      nodeId: '01', nodeText: 'Folders', iconCss: 'e-folder e-icons', routerLink: 'folders'
    },
    {
      nodeId: '02', nodeText: 'Settings', iconCss: 'e-settings e-icons', routerLink: 'settings'
    },
    {
      nodeId: '03', nodeText: 'Error Testing', iconCss: 'e-bug-report e-icons', routerLink: 'error-testing'
    }
  ];

  public width: string = '290px';
  public target: string = '.main-sidebar-content';
  public mediaQuery: string = '(min-width: 600px)';
  public fields: object = {
    dataSource: this.data,
    id: 'nodeId',
    text: 'nodeText',
    child: 'nodeChild',
    iconCss: "iconCss"
  }

  constructor(
    private router: Router,
    private estimationService: EstimationService,
    private parse: ParseService,
    private electronWindowService: ElectronWindowService,
    private indexingService: IndexingService,
    private healthCheckService: HealthCheckService,
    private featureFlagsService: FeatureFlagsService
  ) {}

  async ngOnInit() {
    this._selectMenuNode();

    // Check initial window maximized state
    this.isMaximized = await this.electronWindowService.isMaximized();

    // Check window state periodically
    setInterval(async () => {
      this.isMaximized = await this.electronWindowService.isMaximized();
    }, 1000);

    // Start watching folders for changes
    // This ensures folder watching continues even when navigating away from the Folders component
    this.indexingService.startWatchingFolders().subscribe(
      success => {
        console.log('Started watching folders for changes (app level)');
      },
      error => {
        console.error('Error starting folder watching (app level):', error);
      }
    );

    // Start health checks if enabled via feature flag
    this.featureFlagsService.isEnabled('health-checks').subscribe(enabled => {
      if (enabled) {
        console.log('Starting health checks');
        this.healthCheckService.startHealthChecks();

        // Subscribe to health status updates
        this.healthCheckService.getHealth().subscribe(health => {
          console.log(`System health: ${health.status}`);
        });
      }
    });
  }

  toolbarCliked(): void {
    this.sidebarTreeviewInstance.toggle();
  }

  async onNodeSelected($event: any) {
    console.log($event);
    const nodeId = $event.nodeData.id;
    const nodeData = this.treeView?.getTreeData(nodeId);
    const routerLink = nodeData[0]['routerLink'];
    await this.router.navigate([routerLink]);
  }

  // Window control methods
  minimizeWindow(): void {
    this.electronWindowService.minimizeWindow();
  }

  async maximizeWindow(): Promise<void> {
    this.electronWindowService.maximizeWindow();
    // Update the maximized state
    this.isMaximized = await this.electronWindowService.isMaximized();
  }

  closeWindow(): void {
    this.electronWindowService.closeWindow();
  }

  private _selectMenuNode() {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: NavigationEnd) => {
      // this.selectedNodes = [];
      // const fullPath = this.router.url;
      // const pathSegments = fullPath.split('/');
      // this.data.forEach(node => {
      //   if (pathSegments.includes(node.routerLink)) {
      //     this.selectedNodes.push(node.nodeId);
      //   }
      // })
    });
  }

  toolbarClickHandler(args: ClickEventArgs): void {
    // Get the ID of the clicked toolbar item
    const itemId = args.item?.id;
    console.log('Toolbar item clicked:', itemId);

    // First item is the menu toggle (may not have explicit ID)
    if (itemId === 'resToolbar_0' || args.item?.prefixIcon === 'e-justify') {
      this.sidebarTreeviewInstance.toggle();
      return;
    }

    // Handle window control buttons
    switch (itemId) {
      case 'minimize':
        this.minimizeWindow();
        break;
      case 'maximize':
        this.maximizeWindow();
        break;
      case 'close':
        this.closeWindow();
        break;
    }
  }

}
