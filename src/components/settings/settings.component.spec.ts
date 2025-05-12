import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsComponent } from './settings.component';
import { ElectronWindowService } from '../../providers/electron-window.service';
import { of } from 'rxjs';
import { ButtonAllModule } from '@syncfusion/ej2-angular-buttons';
import { TextBoxAllModule } from '@syncfusion/ej2-angular-inputs';
import { FormsModule } from '@angular/forms';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;
  let electronWindowServiceSpy: jasmine.SpyObj<ElectronWindowService>;

  beforeEach(async () => {
    // Create a spy for the ElectronWindowService
    electronWindowServiceSpy = jasmine.createSpyObj('ElectronWindowService', [
      'getDatabasePath',
      'openDirectory'
    ]);

    // Configure the spy to return mock data
    electronWindowServiceSpy.getDatabasePath.and.resolveTo({
      success: true,
      dbPath: 'C:\\path\\to\\database.db',
      dbDir: 'C:\\path\\to'
    });

    electronWindowServiceSpy.openDirectory.and.resolveTo({
      success: true
    });

    await TestBed.configureTestingModule({
      imports: [
        FormsModule,
        ButtonAllModule,
        TextBoxAllModule,
        SettingsComponent
      ],
      providers: [
        { provide: ElectronWindowService, useValue: electronWindowServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load database path on init', async () => {
    // Call ngOnInit manually
    component.ngOnInit();

    // Wait for async operations to complete
    fixture.detectChanges();
    await fixture.whenStable();

    // Verify the service was called
    expect(electronWindowServiceSpy.getDatabasePath).toHaveBeenCalled();

    // Verify the component properties were updated
    expect(component.databasePath).toBe('C:\\path\\to\\database.db');
    expect(component.databaseDir).toBe('C:\\path\\to');
    expect(component.isLoading).toBe(false);
    expect(component.errorMessage).toBe('');
  });

  it('should handle error when loading database path fails', async () => {
    // Configure the spy to return an error
    electronWindowServiceSpy.getDatabasePath.and.resolveTo({
      success: false,
      error: 'Database path not found'
    });

    // Call the method
    await component.loadDatabasePath();

    // Verify error handling
    expect(component.errorMessage).toBe('Database path not found');
    expect(component.isLoading).toBe(false);
  });

  it('should open database directory when path is available', async () => {
    // Set up component state
    component.databaseDir = 'C:\\path\\to';

    // Call the method
    await component.openDatabaseDirectory();

    // Verify the service was called with the correct path
    expect(electronWindowServiceSpy.openDirectory).toHaveBeenCalledWith('C:\\path\\to');
    expect(component.errorMessage).toBe('');
  });

  it('should show error when trying to open directory with no path', async () => {
    // Set up component state with empty path
    component.databaseDir = '';

    // Call the method
    await component.openDatabaseDirectory();

    // Verify error handling
    expect(electronWindowServiceSpy.openDirectory).not.toHaveBeenCalled();
    expect(component.errorMessage).toBe('Database directory path is not available');
  });

  it('should handle error when opening directory fails', async () => {
    // Set up component state
    component.databaseDir = 'C:\\path\\to';

    // Configure the spy to return an error
    electronWindowServiceSpy.openDirectory.and.resolveTo({
      success: false,
      error: 'Failed to open directory'
    });

    // Call the method
    await component.openDatabaseDirectory();

    // Verify error handling
    expect(electronWindowServiceSpy.openDirectory).toHaveBeenCalledWith('C:\\path\\to');
    expect(component.errorMessage).toBe('Failed to open directory');
  });
});
