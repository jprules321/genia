import { Injectable } from '@angular/core';
import Parse from 'parse';

// Define an interface matching the Gantt Task data structure
// This helps with type safety and aligns with Syncfusion needs
export interface GanttTask {
  // Core Gantt fields
  TaskID: number | string; // Map from Parse objectId
  TaskName: string; // Should not be null/undefined for Gantt
  StartDate: Date; // Must be a valid Date object
  EndDate?: Date | null; // Must be a valid Date object or null
  Duration?: number | null; // Must be a number or null
  Progress?: number; // Must be a number
  Predecessor?: string | null; // Syncfusion uses string format like "1FS+2days". Should be string or null.
  ParentID?: number | string | null; // Map from parentProject pointer's objectId

  // Additional fields from your schema
  notes?: string | null; // Should be string or null
  tags?: string[];
  isCompleted?: boolean;
  location?: Parse.GeoPoint; // Needs custom handling/column if displayed
  metadata?: object;
  // attachment?: Parse.File; // Needs custom handling

  // Store the original Parse object ID for updates/deletes
  objectId?: string;
  // Store the original Parse object for complex updates if needed
  parseObject?: Parse.Object;
}


@Injectable({
  providedIn: 'root' // Service available globally
})
export class ProjectsService {

  // Ensure this matches your Parse class name exactly
  private readonly className = 'Projects';

  constructor() {
    // Initialize Parse if not already done globally (e.g., in main.ts or app.module.ts)
    // Parse.initialize("YOUR_APP_ID", "YOUR_JAVASCRIPT_KEY");
    // Parse.serverURL = 'YOUR_SERVER_URL';
  }

  // --- Data Transformation ---

  /**
   * Converts a value retrieved from Parse into a valid Date object or null.
   * @param parseDateValue The value from Parse (could be Date, string, null, undefined).
   * @param fieldName The name of the field (for logging).
   * @param taskId The task ID (for logging).
   * @returns A Date object or null.
   */
  private parseDateSafely(parseDateValue: any, fieldName: string, taskId: string): Date | null {
    if (!parseDateValue) {
      return null; // Return null if the source value is null, undefined, or empty string
    }
    if (parseDateValue instanceof Date) {
      // Check if the date is valid (sometimes Parse might return invalid date objects)
      if (!isNaN(parseDateValue.getTime())) {
        return parseDateValue; // It's a valid Date object
      } else {
        console.warn(`Task ${taskId}: Invalid Date object encountered for field '${fieldName}' during Parse->Gantt mapping. Value:`, parseDateValue);
        return null; // Invalid Date object
      }
    }
    // If it's not a Date object, try parsing it (e.g., from ISO string)
    try {
      const date = new Date(parseDateValue);
      // Check if parsing resulted in a valid date
      if (!isNaN(date.getTime())) {
        return date; // Successfully parsed to a valid Date
      } else {
        console.warn(`Task ${taskId}: Invalid date format encountered for field '${fieldName}' during Parse->Gantt mapping. Value:`, parseDateValue);
        return null; // Return null for invalid date strings/formats
      }
    } catch (e) {
      console.error(`Task ${taskId}: Error parsing date for field '${fieldName}'. Value:`, parseDateValue, e);
      return null; // Return null on parsing error
    }
  }


  /**
   * Maps a Parse Object (from the 'Projects' class) to the GanttTask interface format.
   * Ensures numeric, date, and string fields conform to Gantt expectations.
   * @param parseObject The Parse object retrieved from the database.
   * @returns A GanttTask object suitable for the Syncfusion Gantt component.
   */
  private mapParseObjectToGanttTask(parseObject: Parse.Object): GanttTask {
    const parentProject = parseObject.get('parentProject'); // Get the Pointer object
    const taskId = parseObject.id; // Use for logging

    // Get raw values from Parse
    const rawStartDate = parseObject.get('startDate');
    const rawEndDate = parseObject.get('endDate');
    const rawDuration = parseObject.get('duration');
    const rawProgress = parseObject.get('progress');
    const rawTaskName = parseObject.get('taskName');
    const rawPredecessor = parseObject.get('predecessor');
    const rawNotes = parseObject.get('notes');

    // --- Process values safely ---
    let startDate = this.parseDateSafely(rawStartDate, 'StartDate', taskId); // Can be Date | null here
    const endDate = this.parseDateSafely(rawEndDate, 'EndDate', taskId); // Can be Date | null

    // Ensure duration is a number or null
    let duration: number | null = null;
    if (typeof rawDuration === 'number' && !isNaN(rawDuration)) {
      duration = rawDuration;
    } else if (rawDuration !== null && rawDuration !== undefined) {
      const parsed = parseFloat(rawDuration);
      if (!isNaN(parsed)) {
        duration = parsed;
      } else {
        console.warn(`Task ${taskId}: Invalid non-numeric value encountered for Duration, setting to null. Value:`, rawDuration);
      }
    }

    // Ensure progress is a number or default to 0
    let progress = 0;
    if (typeof rawProgress === 'number' && !isNaN(rawProgress)) {
      progress = rawProgress;
    } else if (rawProgress !== null && rawProgress !== undefined) {
      const parsedProgress = parseFloat(rawProgress);
      if (!isNaN(parsedProgress)) {
        progress = parsedProgress;
      } else {
        console.warn(`Task ${taskId}: Invalid non-numeric value encountered for Progress, defaulting to 0. Value:`, rawProgress);
      }
    }

    // --- Final Validation & Fallback for StartDate ---
    if (!startDate) {
      console.error(`CRITICAL: Task ${taskId}: StartDate is null or invalid after mapping. Replacing with current date as fallback. Original value:`, rawStartDate);
      startDate = new Date();
    }

    // --- Ensure String Fields are Strings or Null ---
    // Gantt needs TaskName to be a non-empty string.
    const taskName = (typeof rawTaskName === 'string' && rawTaskName.trim()) ? rawTaskName.trim() : `Unnamed Task ${taskId}`; // Provide fallback name
    // Gantt expects Predecessor to be string or null. '' is also acceptable usually.
    const predecessor = (typeof rawPredecessor === 'string') ? rawPredecessor : null;
    // Notes can be string or null.
    const notes = (typeof rawNotes === 'string') ? rawNotes : null;


    // --- Create the GanttTask object ---
    const ganttTask: GanttTask = {
      TaskID: taskId,
      TaskName: taskName, // Use processed taskName
      StartDate: startDate, // Assign the validated (or fallback) Date object
      EndDate: endDate,      // Use safely parsed date or null
      Duration: duration,    // Use processed duration (number or null)
      Progress: progress,    // Use processed progress (number, defaults to 0)
      Predecessor: predecessor, // Use processed predecessor (string or null)
      ParentID: parentProject ? parentProject.id : null,

      // Map additional custom fields
      notes: notes, // Use processed notes (string or null)
      tags: parseObject.get('tags'), // Assuming this is always an array or null/undefined
      isCompleted: parseObject.get('isCompleted') ?? false,
      location: parseObject.get('location'),
      metadata: parseObject.get('metadata'),
      // attachment: parseObject.get('attachment'),

      // Store original Parse objectId
      objectId: taskId,
    };

    // Log the mapped task for debugging just before returning
    // try {
    //   console.log(`[mapParseObjectToGanttTask] Mapped Task (ID: ${taskId}):`, JSON.parse(JSON.stringify(ganttTask)));
    // } catch (e) {
    //    console.error(`[mapParseObjectToGanttTask] Error stringifying mapped task ${taskId} for logging:`, e);
    //    console.log(`[mapParseObjectToGanttTask] Mapped Task (ID: ${taskId}) (raw object):`, ganttTask);
    // }

    return ganttTask;
  }

  /**
   * Maps data from the Gantt component (usually after an edit/add action)
   * to a plain JavaScript object suitable for saving/updating a Parse Object.
   * Uses bracket notation for accessing properties of the parseData object.
   * Ensures string fields are correctly handled (set to null if empty/nullish from Gantt).
   * @param ganttTaskData The data object, typically from Syncfusion's event arguments (args.data).
   * This object structure might vary slightly depending on the action.
   * @returns An object with keys matching Parse field names and values ready for saving.
   */
  public mapGanttTaskToParseData(ganttTaskData: any): { [key: string]: any } {
    // console.log('[mapGanttTaskToParseData] Input (ganttTaskData):', JSON.stringify(ganttTaskData, null, 2));

    // Use optional chaining and nullish coalescing for safer access
    const sourceData = ganttTaskData?.taskData ?? ganttTaskData; // Syncfusion sometimes nests data under 'taskData'

    // Validate required fields based on your Parse schema
    if (!sourceData?.TaskName) {
      console.error('[mapGanttTaskToParseData] ERROR: Input data is missing required "TaskName"!');
      throw new Error("Task Name is required.");
    }
    if (!sourceData?.StartDate) {
      console.error('[mapGanttTaskToParseData] ERROR: Input data is missing required "StartDate"!');
      throw new Error("Start Date is required.");
    }

    // Initialize parseData object
    const parseData: { [key: string]: any } = {};

    // Map Gantt property name (PascalCase from sourceData) to Parse field name (camelCase)
    // Ensure TaskName is not empty string, treat as error if it is (as it's required)
    parseData['taskName']    = (typeof sourceData.TaskName === 'string' && sourceData.TaskName.trim()) ? sourceData.TaskName.trim() : null;
    if (parseData['taskName'] === null) {
      throw new Error("Task Name cannot be empty.");
    }

    parseData['startDate']   = sourceData.StartDate; // Will be validated/converted below
    parseData['endDate']     = sourceData.EndDate;   // Handle potential null/undefined
    parseData['duration']    = sourceData.Duration;  // Handle potential null/undefined
    parseData['progress']    = sourceData.Progress ?? 0; // Default to 0 if null/undefined

    // Handle Predecessor: Ensure it's a string or null before saving to Parse
    const rawPredecessor = sourceData.Predecessor;
    parseData['predecessor'] = (typeof rawPredecessor === 'string' && rawPredecessor.trim()) ? rawPredecessor.trim() : null; // Send null if empty/not string

    // Handle Notes: Ensure it's a string or null before saving to Parse
    const rawNotes = sourceData.notes ?? sourceData.Notes;
    parseData['notes']       = (typeof rawNotes === 'string' && rawNotes.trim()) ? rawNotes.trim() : null; // Send null if empty/not string

    parseData['tags']        = sourceData.tags ?? sourceData.Tags; // Assume array or null/undefined
    parseData['isCompleted'] = sourceData.isCompleted ?? sourceData.IsCompleted ?? false; // Default to false
    parseData['location']    = sourceData.location; // Pass GeoPoint object if available
    parseData['metadata']    = sourceData.metadata; // Pass object if available
    // parseData['attachment'] = sourceData.attachment // Handle File object if needed

    // --- Handle Parent Pointer ---
    if (sourceData.ParentID) {
      const parentPointer = Parse.Object.extend(this.className);
      parseData['parentProject'] = parentPointer.createWithoutData(sourceData.ParentID);
    } else {
      parseData['parentProject'] = undefined; // Will be handled by updateTask unset logic if needed
    }

    // --- Date Validation and Conversion ---
    ['startDate', 'endDate'].forEach(dateField => {
      if (parseData[dateField]) {
        if (!(parseData[dateField] instanceof Date)) {
          const parsedDate = new Date(parseData[dateField]);
          if (!isNaN(parsedDate.getTime())) {
            parseData[dateField] = parsedDate;
          } else {
            console.warn(`Invalid ${dateField} format encountered during mapping:`, parseData[dateField]);
            if (dateField === 'startDate') {
              throw new Error(`Invalid Start Date format: ${parseData[dateField]}`);
            } else {
              parseData[dateField] = null;
            }
          }
        }
        else if (isNaN(parseData[dateField].getTime())) {
          console.warn(`Invalid Date object encountered for ${dateField} during mapping:`, parseData[dateField]);
          if (dateField === 'startDate') {
            throw new Error(`Invalid Start Date object: ${parseData[dateField]}`);
          } else {
            parseData[dateField] = null;
          }
        }
      } else {
        parseData[dateField] = null;
      }
    });

    // Remove properties with `undefined` values before saving to Parse
    Object.keys(parseData).forEach(key => {
      if (parseData[key] === undefined) { // Keep null values, remove undefined
        delete parseData[key];
      }
    });

    // Ensure duration is a number or null before saving to Parse
    if (parseData.hasOwnProperty('duration')) {
      const dur = parseData['duration'];
      if (typeof dur !== 'number' && dur !== null) {
        const parsedDur = parseFloat(dur);
        parseData['duration'] = !isNaN(parsedDur) ? parsedDur : null;
      } else if (typeof dur === 'number' && isNaN(dur)) {
        parseData['duration'] = null;
      }
    }
    // Ensure progress is a number or null before saving to Parse
    if (parseData.hasOwnProperty('progress')) {
      const prog = parseData['progress'];
      if (typeof prog !== 'number' && prog !== null) {
        const parsedProg = parseFloat(prog);
        parseData['progress'] = !isNaN(parsedProg) ? parsedProg : null; // Or 0
      } else if (typeof prog === 'number' && isNaN(prog)) {
        parseData['progress'] = null; // Or 0
      }
    }

    // console.log('[mapGanttTaskToParseData] Output (parseData):', JSON.stringify(parseData, null, 2));
    return parseData;
  }


  // --- CRUD Operations ---
  // (addTask, updateTask, deleteTask, etc. remain the same)

  /**
   * Fetches all tasks from the Parse 'Projects' class.
   * @returns A promise that resolves with an array of GanttTask objects.
   */
  async getTasks(): Promise<GanttTask[]> {
    try {
      const query = new Parse.Query(this.className);
      query.ascending('startDate'); // Or any other desired sorting
      query.limit(1000); // Adjust limit as needed, consider pagination for very large datasets
      // Include the 'parentProject' pointer data if needed immediately, though mapping uses only its ID
      // query.include('parentProject');
      // @ts-ignore
      const results: Parse.Object[] = await query.find();

      // Map each Parse object to the GanttTask format
      // Ensure mapParseObjectToGanttTask is correctly bound or use an arrow function
      return results.map(parseObject => this.mapParseObjectToGanttTask(parseObject));

    } catch (error) {
      console.error('Error fetching tasks from Parse:', error);
      throw error; // Re-throw to be caught by the component
    }
  }

  /**
   * Adds a new task to the Parse 'Projects' class.
   * @param ganttTaskData Data for the new task, typically from the Gantt add dialog.
   * @returns A promise that resolves with the newly created GanttTask (including its Parse objectId).
   */
  async addTask(ganttTaskData: any): Promise<GanttTask> {
    try {
      const TaskObject = Parse.Object.extend(this.className);
      const newTask = new TaskObject();

      // Map the input data to the Parse schema format
      const parseData = this.mapGanttTaskToParseData(ganttTaskData);
      console.log("Data being saved to Parse for Add:", parseData);

      // Save the new object to Parse
      const savedObject = await newTask.save(parseData);
      console.log('Parse add success:', savedObject);

      // Return the newly created task mapped back to GanttTask format
      // @ts-ignore
      return this.mapParseObjectToGanttTask(savedObject);
    } catch (error) {
      console.error('Error adding task to Parse:', error);
      // Log the data that failed to save for debugging
      console.error('Data that failed to add:', ganttTaskData);
      throw error; // Re-throw
    }
  }

  /**
   * Updates an existing task in the Parse 'Projects' class.
   * @param ganttTaskData Data for the task to update, MUST include an 'objectId'.
   * @returns A promise that resolves with the updated GanttTask.
   */
  async updateTask(ganttTaskData: any & { objectId: string }): Promise<GanttTask> {
    // Use objectId directly from the argument which should be enforced by the caller
    const objectId = ganttTaskData.objectId;
    if (!objectId) {
      console.error("Update failed: Missing objectId in input data.", ganttTaskData);
      throw new Error('Cannot update task without objectId.');
    }

    try {
      const TaskObject = Parse.Object.extend(this.className);
      const query = new Parse.Query(TaskObject);
      // Fetch the object to update
      const taskToUpdate = await query.get(objectId);

      // Map the incoming Gantt data to Parse format
      const parseData = this.mapGanttTaskToParseData(ganttTaskData);
      console.log(`Data being saved to Parse for Update (ID: ${objectId}):`, parseData);


      // Set the updated fields on the fetched Parse object
      // Using bracket notation for access within the loop
      Object.keys(parseData).forEach(key => {
        // Skip setting parentProject if it wasn't included in parseData (meaning ParentID was null/empty)
        // We handle unsetting it explicitly below.
        if (key !== 'parentProject' || parseData[key] !== undefined) { // Note: undefined check here is correct
          taskToUpdate.set(key, parseData[key]);
        }
      });

      // --- Handle Unsetting Parent Pointer ---
      // If parseData.parentProject is undefined (meaning ParentID was null/empty in ganttTaskData)
      // AND the task currently has a parentProject set, then unset it.
      // @ts-ignore
      if (parseData['parentProject'] === undefined && taskToUpdate.has('parentProject')) {
        console.log(`Unsetting parentProject for task ${objectId}`);
        taskToUpdate.unset('parentProject');
      }

      // Save the changes back to Parse
      const updatedObject = await taskToUpdate.save();

      // --- Add this check ---
      if (!updatedObject?.id) {
        console.error("CRITICAL: Parse object saved successfully but has no ID!", updatedObject);
        throw new Error("Failed to update task data integrity: Missing ID after save.");
      }
      // --- End check ---

      console.log('Parse update success:', updatedObject);

      // Return the updated task mapped back to GanttTask format
      // Ensure mapParseObjectToGanttTask is correctly bound or use an arrow function
      // @ts-ignore
      return this.mapParseObjectToGanttTask(updatedObject);

    } catch (error) {
      console.error(`Error updating task ${objectId} in Parse:`, error);
      // Log the data that failed for debugging
      console.error('Data that failed to update:', ganttTaskData);
      throw error; // Re-throw
    }
  }

  /**
   * Deletes a task from the Parse 'Projects' class.
   * @param objectId The Parse objectId of the task to delete.
   * @returns A promise that resolves when deletion is complete.
   */
  async deleteTask(objectId: string): Promise<void> {
    if (!objectId) {
      console.error("Delete failed: Missing objectId.");
      throw new Error('Cannot delete task without objectId.');
    }
    try {
      const TaskObject = Parse.Object.extend(this.className);
      const query = new Parse.Query(TaskObject);
      const taskToDelete = await query.get(objectId);
      await taskToDelete.destroy();
      console.log('Parse delete success:', objectId);
    } catch (error) {
      console.error(`Error deleting task ${objectId} from Parse:`, error);
      throw error; // Re-throw
    }
  }

  // --- Relation Handling (Example - adjust as needed) ---
  // Add/Remove users or other relations if your schema requires it
  async assignUserToTask(taskId: string, userId: string): Promise<void> {
    // Implementation would be similar to updateTask, fetching the task
    // and modifying the 'assignedUsers' relation.
    try {
      const TaskObject = Parse.Object.extend(this.className);
      const query = new Parse.Query(TaskObject);
      const task = await query.get(taskId);

      const userQuery = new Parse.Query(Parse.User);
      const user = await userQuery.get(userId); // Get the User object to relate

      const relation = task.relation('assignedUsers');
      relation.add(user);
      await task.save();
      console.log(`Assigned user ${userId} to task ${taskId}`);
    } catch (error) {
      console.error('Error assigning user:', error);
      throw error;
    }
  }

  async removeUserFromTask(taskId: string, userId: string): Promise<void> {
    try {
      const TaskObject = Parse.Object.extend(this.className);
      const query = new Parse.Query(TaskObject);
      const task = await query.get(taskId);

      const userQuery = new Parse.Query(Parse.User);
      const user = await userQuery.get(userId); // Get the User object to unrelate

      const relation = task.relation('assignedUsers');
      relation.remove(user);
      await task.save();
      console.log(`Removed user ${userId} from task ${taskId}`);
    } catch (error) {
      console.error('Error removing user:', error);
      throw error;
    }
  }

}
