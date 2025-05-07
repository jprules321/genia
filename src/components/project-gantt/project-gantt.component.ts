import { Component, OnInit, OnDestroy, ViewChild, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  GanttModule,
  GanttComponent,
  ToolbarService,
  EditService,
  SelectionService,
  FilterService,
  SortService,
  ResizeService,
  ReorderService,
  RowDDService,
  ColumnMenuService,
  EditSettingsModel,
  ToolbarItem,
  IActionBeginEventArgs, // Use specific interface if available
  // ActionEventArgs is often from grids, check Syncfusion docs for exact Gantt event args type
} from '@syncfusion/ej2-angular-gantt';

// Correct import for ActionEventArgs (often from ej2-grids, but verify for Gantt)
// If specific Gantt types exist (e.g., IGanttActionEventArgs), prefer those.
// Note: The generic ActionEventArgs might cause IDEs to warn about unreachable cases below,
// as it may not list all possible Gantt-specific requestType strings.
import { ActionEventArgs, DataSourceChangedEventArgs } from '@syncfusion/ej2-grids';
import { ClickEventArgs } from '@syncfusion/ej2-navigations';


// Import the service and interface
import { GanttTask, ProjectsService } from '../../providers/projects.service'; // Adjust path if needed

@Component({
  selector: 'app-project-gantt',
  standalone: true,
  imports: [
    CommonModule,
    GanttModule // Import Syncfusion Gantt Module
  ],
  templateUrl: './project-gantt.component.html',
  // Add component-specific styles if needed
  styleUrls: ['./project-gantt.component.scss'], // Added styleUrls based on uploaded files
  providers: [
    // Provide necessary Syncfusion services for features used
    ToolbarService,
    EditService,
    SelectionService,
    FilterService,
    SortService,
    ResizeService,
    ReorderService,
    RowDDService,
    ColumnMenuService
  ],
  changeDetection: ChangeDetectionStrategy.OnPush // Use OnPush for better performance
})
export class ProjectGanttComponent implements OnInit, OnDestroy {
  // Inject the service and ChangeDetectorRef
  private projectsService = inject(ProjectsService);
  private cdr = inject(ChangeDetectorRef);
  private destroy$ = new Subject<void>(); // For unsubscribing

  @ViewChild('gantt') // Reference to the Gantt component in the template
  public gantt?: GanttComponent;

  public ganttData: GanttTask[] = []; // Data source for the Gantt chart
  public isLoading = true;
  public errorMessage: string | null = null;

  // --- Gantt Configuration ---

  // Map Gantt properties (left) to your GanttTask interface fields (right)
  public taskFields: object = {
    id: 'TaskID',          // Maps to Parse objectId via service
    name: 'TaskName',
    startDate: 'StartDate',
    endDate: 'EndDate',
    duration: 'Duration',
    progress: 'Progress',
    dependency: 'Predecessor', // Field containing predecessor strings
    parentID: 'ParentID',      // Maps to parentProject pointer ID via service
    notes: 'notes',          // Custom field
    // Add mappings for other custom fields if needed
    // e.g., customField: 'myCustomDataField'
  };

  // Define grid columns
  public columns: object[] = [
    // { field: 'TaskID', headerText: 'ID', width: '80', visible: false }, // Usually hide internal ID
    { field: 'TaskName', headerText: 'Task Name', width: '250', clipMode: 'EllipsisWithTooltip' },
    { field: 'StartDate', headerText: 'Start Date', format: 'dd-MMM-yy', width: '120', editType: 'datepickeredit' },
    { field: 'Duration', headerText: 'Duration', width: '100', textAlign: 'Right', editType: 'numericedit', allowEditing: true }, // Ensure editable if needed
    { field: 'EndDate', headerText: 'End Date', format: 'dd-MMM-yy', width: '120', editType: 'datepickeredit' },
    { field: 'Progress', headerText: 'Progress', width: '120', textAlign: 'Right', format: 'N0', editType: 'numericedit' },
    { field: 'Predecessor', headerText: 'Predecessor', width: '120', allowEditing: true }, // Ensure editable
    { field: 'notes', headerText: 'Notes', width: '200', allowEditing: true }, // Ensure editable
    // Add custom columns here if needed
    // { field: 'isCompleted', headerText: 'Completed', width: '100', type: 'boolean', displayAsCheckBox: true, editType: 'booleanedit' },
  ];

  // Configure editing options
  public editSettings: EditSettingsModel = {
    allowAdding: true,
    allowEditing: true,
    allowDeleting: true,
    allowTaskbarEditing: true, // Allows dragging/resizing taskbars -> triggers 'taskbarEditing' requestType
    mode: 'Dialog',           // Or 'Auto' (inline)
    showDeleteConfirmDialog: true
  };

  // Define toolbar items
  public toolbar: (ToolbarItem | string)[] = [
    'Add', 'Edit', 'Update', 'Delete', 'Cancel', // Standard edit actions
    'ExpandAll', 'CollapseAll',                // Hierarchy view controls
    'Search',                                  // Search functionality
    'Indent', 'Outdent',                       // Hierarchy editing -> triggers 'indent'/'outdent' requestType
    // Add custom toolbar buttons if needed
    // { text: 'Custom Action', tooltipText: 'Perform custom action', id: 'custom_action_button' }
  ];

  // Configure taskbar labels
  public labelSettings: object = {
    rightLabel: 'TaskName' // Show task name on the right side of the taskbar
    // leftLabel: 'Progress' // Example: Show progress on the left
  };

  // Splitter position between grid and chart
  public splitterSettings: object = {
    columnIndex: 2 // Split after the second column (Task Name)
  };

  // Project start and end dates (can be calculated or fixed)
  public projectStartDate?: Date;
  public projectEndDate?: Date;

  ngOnInit(): void {
    this.loadGanttData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Loads data from the Parse backend via the service.
   */
  async loadGanttData(): Promise<void> {
    console.log('Loading Gantt data...');
    this.isLoading = true;
    this.errorMessage = null;
    this.cdr.markForCheck(); // Notify Angular about the change

    try {
      const rawData = await this.projectsService.getTasks();
      // Log data received from service *before* assigning to component property
      // console.log('Data received from service (before assigning to ganttData):', JSON.parse(JSON.stringify(rawData)));
      this.ganttData = rawData; // Assign data to the component property bound to Gantt

      console.log('Gantt data loaded and assigned.');

      this.calculateProjectDates(); // Calculate project boundaries after loading

      // If using OnPush, manually trigger change detection after data updates
      this.cdr.markForCheck();

    } catch (error: any) {
      console.error('Failed to load Gantt data:', error);
      this.errorMessage = `Error loading data: ${error.message || 'Unknown error'}`;
      this.ganttData = []; // Clear data on error
      this.projectStartDate = new Date(); // Reset dates on error
      this.projectEndDate = new Date(new Date().setDate(new Date().getDate() + 30));
      this.cdr.markForCheck(); // Update UI with error message
    } finally {
      this.isLoading = false;
      // Explicitly tell Angular that loading state has changed
      this.cdr.markForCheck();

      // Refresh Gantt component after data is loaded/updated
      if (this.gantt) {
        console.log('Refreshing Gantt component...');
        this.gantt.projectStartDate = this.projectStartDate;
        this.gantt.projectEndDate = this.projectEndDate;

        // Use refreshDataSource for potentially better handling of data updates
        // The 'true' argument indicates that the data source has been completely replaced
        //this.gantt.refreshDataSource(true);

        // Optional: A full refresh might be needed in some complex scenarios, but try refreshDataSource first.
        this.gantt.refresh();

        console.log('Gantt component data refreshed.');
      } else {
        console.warn('Gantt component instance not available in finally block.');
      }
    }
  }

  /**
   * Calculates the project start and end dates based on the loaded tasks.
   * Sets default dates if no tasks are found.
   */
  private calculateProjectDates(): void {
    if (this.ganttData.length > 0) {
      let minStartDate = Infinity;
      let maxEndDate = -Infinity;

      this.ganttData.forEach(task => {
        // Ensure StartDate is a valid Date object before using getTime()
        if (task.StartDate instanceof Date && !isNaN(task.StartDate.getTime())) {
          const startTime = task.StartDate.getTime();
          if (startTime < minStartDate) {
            minStartDate = startTime;
          }

          // Calculate potential end date based on EndDate or StartDate+Duration
          let potentialEndDate: Date | null = null;
          if (task.EndDate instanceof Date && !isNaN(task.EndDate.getTime())) {
            potentialEndDate = task.EndDate;
          } else if (typeof task.Duration === 'number' && task.Duration >= 0) {
            potentialEndDate = new Date(task.StartDate); // Start from the valid start date
            // Adjust based on how Syncfusion calculates duration (days, hours, etc.)
            // Assuming Duration is in days for this example:
            potentialEndDate.setDate(potentialEndDate.getDate() + task.Duration);
          } else {
            potentialEndDate = new Date(task.StartDate); // Fallback if only start date exists
          }

          if (potentialEndDate instanceof Date && !isNaN(potentialEndDate.getTime())) {
            const endTime = potentialEndDate.getTime();
            if (endTime > maxEndDate) {
              maxEndDate = endTime;
            }
          }
        } else {
          console.warn(`Task ${task.TaskID} has invalid or missing StartDate during project date calculation.`);
        }
      });

      this.projectStartDate = minStartDate !== Infinity ? new Date(minStartDate) : new Date();
      // Ensure maxEndDate is valid and after minStartDate
      this.projectEndDate = maxEndDate !== -Infinity && maxEndDate >= minStartDate
        ? new Date(maxEndDate)
        : new Date(this.projectStartDate.getTime() + 30 * 24 * 60 * 60 * 1000); // Default 30 days if no valid end found

    } else {
      // Default project dates if no tasks exist
      this.projectStartDate = new Date();
      this.projectEndDate = new Date();
      this.projectEndDate.setDate(this.projectStartDate.getDate() + 30); // e.g., 30 days duration
    }
    // console.log(`Project Dates Calculated: Start=${this.projectStartDate?.toISOString()}, End=${this.projectEndDate?.toISOString()}`);
  }


  // --- Gantt Event Handlers ---

  /**
   * Intercepts actions before they are executed by the Gantt component.
   * Used here primarily to set default values for new tasks before the add dialog opens.
   * @param args Event arguments containing action details.
   */
  public actionBeginHandler(args: ActionEventArgs): void {
    // Use the specific type if available, e.g., IActionBeginEventArgs
    // Check the requestType to identify the action
    // @ts-ignore - Syncfusion types can sometimes be inconsistent
    const requestType = args.requestType as string; // Use specific type if possible
    // @ts-ignore
    const rowData = args.rowData as GanttTask | undefined; // Cast for easier access
    // @ts-ignore
    const data = args.data as GanttTask | undefined; // Data for save action

    console.log(`actionBegin: requestType='${requestType}'`);

    if (requestType === 'beforeOpenAddDialog') {
      console.log('actionBegin: beforeOpenAddDialog - Setting defaults');
      // Set default values for the new task row data
      const defaultData = rowData as Partial<GanttTask>; // Use Partial for defaults
      if (defaultData) {
        // Set default StartDate to project start or today if not set
        if (!defaultData.StartDate) {
          defaultData.StartDate = this.projectStartDate ? new Date(this.projectStartDate) : new Date();
        }
        // Set default Duration if not set
        if (defaultData.Duration === null || typeof defaultData.Duration === 'undefined') {
          defaultData.Duration = 1; // Default to 1 day duration
        }
        // Set default Progress if not set
        if (defaultData.Progress === null || typeof defaultData.Progress === 'undefined') {
          defaultData.Progress = 0;
        }
        // console.log('Setting default values for new task:', defaultData);
      }
    } else if (requestType === 'beforeOpenEditDialog') {
      // *** ADDED DETAILED LOGGING FOR EDIT DIALOG ***
      console.log('actionBegin: beforeOpenEditDialog - Checking rowData...');
      if (rowData) {
        console.log('  rowData received:', JSON.parse(JSON.stringify(rowData))); // Log the data itself
        console.log(`  rowData.TaskID: ${rowData.TaskID}, Type: ${typeof rowData.TaskID}`);
        console.log(`  rowData.TaskName: ${rowData.TaskName}`);
        console.log(`  rowData.StartDate: ${rowData.StartDate}, IsDate: ${rowData.StartDate instanceof Date}`);
        // Log other relevant fields
      } else {
        console.error('  ERROR: rowData is missing or undefined in beforeOpenEditDialog!');
        // Optionally cancel the edit if data is missing?
        // args.cancel = true;
      }
    } else if (requestType === 'save') {
      // This triggers *before* the data is sent for add/edit in the dialog
      console.log('actionBegin: save (dialog save button clicked), Data:', data ? JSON.parse(JSON.stringify(data)) : 'undefined');
      // You could perform validation here before allowing the save action to complete
      // Example validation:
      // if (data && (!data.TaskName || data.TaskName.trim() === '')) {
      //     this.showError("Task Name cannot be empty.");
      //     args.cancel = true; // Prevent the save action
      // }
    }
  }

  /**
   * Handles actions *after* they have been completed in the Gantt UI.
   * This is the primary place to synchronize changes with the Parse backend.
   * @param args Event arguments containing action details and resulting data.
   */
  public async actionCompleteHandler(args: ActionEventArgs): Promise<void> {
    // @ts-ignore - Syncfusion types can be inconsistent, access requestType directly
    const requestType = args.requestType as string; // Assert as string for switch statement
    console.log(`actionComplete: requestType='${requestType}', Action='${(args as any).action}'`);
    // Avoid logging args.data directly here if it causes circular JSON errors, inspect specific properties if needed

    // Only proceed with backend sync for actions that modify data
    const modifyingActions = ['add', 'save', 'taskbarEditing', 'editing', 'delete', 'indent', 'outdent'];
    if (!modifyingActions.includes(requestType)) {
      console.log(`actionComplete: Ignoring non-modifying action type: ${requestType}`);
      return; // Exit if it's just filtering, sorting, etc.
    }


    this.isLoading = true; // Show loading indicator during backend sync
    this.cdr.markForCheck();

    try {
      switch (requestType) {
        case 'add':
        case 'save': // 'save' is often used for both add and edit completion from dialog
          // *** USING THE CORRECTED isAdding CHECK ***
          // Distinguish add vs edit based on whether objectId exists in the event data
          // args.data is the primary source after dialog save
          // args.rowData might contain the original data before edit
          // @ts-ignore - Accessing potentially nested/inconsistent properties
          const isAdding = !(args.data?.objectId || args.rowData?.objectId);
          // @ts-ignore
          const taskDataToAddOrUpdate = args.data as any; // This holds the data from the save action

          if (isAdding) {
            console.log('--- Handling Add ---');
            if (!taskDataToAddOrUpdate) { throw new Error("No data provided for add operation."); }
            console.log('Add data from dialog:', JSON.parse(JSON.stringify(taskDataToAddOrUpdate)));
            // Map and send data to Parse for creation
            await this.projectsService.addTask(taskDataToAddOrUpdate);
            console.log('Task added successfully via service.');
            // Reload data to get the new objectId and ensure consistency
            await this.loadGanttData();
          } else {
            console.log('--- Handling Update (from Save) ---');
            // Ensure objectId is present for update
            // @ts-ignore - Find objectId reliably from args.data or args.rowData
            const objectId = taskDataToAddOrUpdate?.objectId ?? args.rowData?.objectId;
            if (!objectId) {
              console.error("Update failed: Could not find objectId in event data.", args);
              // Attempt to find it on the raw data object if possible
              // @ts-ignore
              const idFromTaskData = args.data?.TaskID;
              if(idFromTaskData) {
                console.warn(`Falling back to TaskID (${idFromTaskData}) as objectId.`);
                // Retry update with TaskID if objectId wasn't found directly
                const dataToSendFallback = { ...taskDataToAddOrUpdate, objectId: idFromTaskData };
                await this.projectsService.updateTask(dataToSendFallback);
                console.log(`Task ${idFromTaskData} updated successfully via service (using TaskID fallback).`);
              } else {
                throw new Error("Update failed: Task identifier (objectId/TaskID) missing.");
              }
            } else {
              // Prepare data with objectId and send for update
              // Ensure we use the latest data from args.data
              const dataToSend = { ...taskDataToAddOrUpdate, objectId: objectId };
              console.log('Update data from dialog:', JSON.parse(JSON.stringify(dataToSend)));
              await this.projectsService.updateTask(dataToSend);
              console.log(`Task ${objectId} updated successfully via service.`);
            }
            // Reload data to ensure consistency after update
            await this.loadGanttData();
          }
          break; // End of 'add'/'save' case

        case 'taskbarEditing': // Handles drag/drop resizing/moving of taskbars
        case 'editing': // May trigger for other inline edits if mode='Auto' or specific interactions
          console.log('--- Handling Update (Taskbar/Inline Edit) ---');
          // @ts-ignore - Data is usually directly in args.data for taskbar edits
          const updatedTaskData = args.data as any;
          // @ts-ignore - Find objectId reliably (should exist in the data for existing tasks)
          const objectIdForUpdate = updatedTaskData?.objectId ?? updatedTaskData?.TaskID;

          if (!objectIdForUpdate) {
            console.error("Update failed: Could not find objectId in taskbar edit data.", args);
            // Don't throw error immediately, maybe log and try reloading
            this.showError("Update failed: Task identifier missing during taskbar edit.");
            await this.loadGanttData(); // Reload to sync UI
            break; // Exit this case
          }
          // Prepare data with objectId and send for update
          const dataToSendForUpdate = { ...updatedTaskData, objectId: objectIdForUpdate };
          console.log('Update data from taskbar/inline:', JSON.parse(JSON.stringify(dataToSendForUpdate)));
          await this.projectsService.updateTask(dataToSendForUpdate);
          console.log(`Task ${objectIdForUpdate} updated (taskbar/inline) successfully.`);
          // Reload data to ensure consistency (especially if dates/duration changed)
          await this.loadGanttData();
          break; // End of 'taskbarEditing'/'editing' case

        case 'delete':
          console.log('--- Handling Delete ---');
          // args.data is usually an *array* of items to delete
          const tasksToDelete = args.data as GanttTask[];
          if (!tasksToDelete || tasksToDelete.length === 0) {
            console.warn("Delete action triggered but no tasks found in args.data.");
            break; // Exit if no data
          }

          // Use Promise.all for potentially deleting multiple tasks concurrently
          await Promise.all(tasksToDelete.map(async (task) => {
            // Get objectId from TaskID (assuming TaskID is the objectId)
            const objectIdToDelete = task.TaskID as string; // TaskID should be the objectId from mapping
            if (!objectIdToDelete) {
              console.error("Delete failed: Missing TaskID (objectId) for task:", task);
              return; // Skip this task if ID is missing
            }
            await this.projectsService.deleteTask(objectIdToDelete);
            console.log(`Task ${objectIdToDelete} deleted successfully via service.`);
          }));

          // Reload data after delete to ensure consistency, as Gantt might only remove visually
          await this.loadGanttData();
          break; // End of 'delete' case

        case 'indent':
        case 'outdent':
          console.log(`--- Handling ${requestType} ---`);
          // @ts-ignore - Data after indent/outdent is in args.data
          const hierarchyChangeData = args.data as any;
          // @ts-ignore - Find objectId reliably
          const objectIdForHierarchy = hierarchyChangeData?.objectId ?? hierarchyChangeData?.TaskID;

          if (!objectIdForHierarchy) {
            console.error(`${requestType} failed: Missing objectId.`, args);
            this.showError("Hierarchy update failed: Task identifier missing.");
            await this.loadGanttData(); // Reload to sync UI
            break; // Exit this case
          }

          // Prepare data (ParentID should be updated by Gantt) and send for update
          const dataToSendForHierarchy = { ...hierarchyChangeData, objectId: objectIdForHierarchy };
          console.log('Update data from indent/outdent:', JSON.parse(JSON.stringify(dataToSendForHierarchy)));
          await this.projectsService.updateTask(dataToSendForHierarchy);
          console.log(`Task hierarchy (${requestType}) for ${objectIdForHierarchy} updated.`);

          // Reloading after indent/outdent is often good to ensure all related calculations (dates, etc.) are correct
          await this.loadGanttData();
          break; // End of 'indent'/'outdent' case

        default:
          // Log other request types that might modify data but aren't explicitly handled
          console.warn(`actionComplete: Potentially modifying requestType '${requestType}' not explicitly handled.`);
          break; // End of default case
      } // End of switch statement

      // Clear any previous error message on success
      this.errorMessage = null;

    } catch (error: any) {
      // Catch errors from ANY of the above Parse operations or data processing steps
      console.error(`Parse operation for ${requestType} failed:`, error);
      this.showError(`Failed operation (${requestType}): ${error.message || 'Unknown error'}`);
      // CRUCIAL: Reload data to revert potential optimistic UI changes from Syncfusion
      // if the backend operation failed, ensuring UI matches the actual backend state.
      console.log('Error occurred during actionComplete, reloading data to ensure consistency...');
      await this.loadGanttData(); // Reload data on error
    } finally {
      // Ensure loading is turned off even if action was ignored
      if (this.isLoading) {
        this.isLoading = false;
        this.cdr.markForCheck(); // Ensure loading state is updated in the UI
      }
    }
  }

  /**
   * Handles clicks on toolbar items.
   * Useful if you add custom toolbar buttons.
   * @param args Click event arguments.
   */
  toolbarClickHandler(args: ClickEventArgs): void {
    // Check the ID of the clicked item
    // @ts-ignore - Syncfusion type might be generic, access item properties
    const itemId = args.item?.id;
    console.log('Toolbar item clicked:', itemId);

    // Example: Handle a custom button click
    // if (itemId === 'gantt_custom_action_button') { // Use the ID you defined in the toolbar config
    //   console.log('Custom action button clicked!');
    //   // Perform your custom action here
    //   // Maybe open a dialog, call a specific service method, etc.
    // }

    // Standard toolbar items (Add, Edit, Delete, etc.) trigger
    // actionBegin/actionComplete, so usually no specific handling is needed here
    // unless you want to override or augment their behavior.
  }

  /**
   * Helper method to display temporary error messages.
   * @param message The error message to display.
   */
  private showError(message: string): void {
    this.errorMessage = message;
    this.isLoading = false; // Ensure loading is off when showing error
    this.cdr.markForCheck(); // Update UI
    // Optionally clear the message after a delay
    // setTimeout(() => {
    //   if (this.errorMessage === message) { // Clear only if it hasn't been replaced
    //      this.errorMessage = null;
    //      this.cdr.markForCheck();
    //   }
    // }, 7000); // Hide after 7 seconds
  }
}
