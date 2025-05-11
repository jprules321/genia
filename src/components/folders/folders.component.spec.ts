import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { FoldersComponent } from './folders.component';
import { FoldersService } from '../../providers/folders.service';
import { of } from 'rxjs';

describe('FoldersComponent', () => {
  let component: FoldersComponent;
  let fixture: ComponentFixture<FoldersComponent>;
  let foldersServiceSpy: jasmine.SpyObj<FoldersService>;

  beforeEach(async () => {
    // Create a spy for FoldersService
    const spy = jasmine.createSpyObj('FoldersService', ['getFolders', 'addFolder', 'updateFolder', 'deleteFolder']);

    await TestBed.configureTestingModule({
      imports: [FormsModule, FoldersComponent],
      providers: [
        { provide: FoldersService, useValue: spy }
      ]
    }).compileComponents();

    foldersServiceSpy = TestBed.inject(FoldersService) as jasmine.SpyObj<FoldersService>;
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(FoldersComponent);
    component = fixture.componentInstance;

    // Setup default return values for service methods
    foldersServiceSpy.getFolders.and.returnValue(of([]));

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load folders on init', () => {
    const testFolders = [
      { id: '1', path: '/path/to/folder1', name: 'folder1', createdAt: new Date() },
      { id: '2', path: '/path/to/folder2', name: 'folder2', createdAt: new Date() }
    ];

    foldersServiceSpy.getFolders.and.returnValue(of(testFolders));

    component.ngOnInit();

    expect(foldersServiceSpy.getFolders).toHaveBeenCalled();
    expect(component.folders).toEqual(testFolders);
  });

  it('should add a new folder', () => {
    const newFolder = { id: '', path: '/path/to/newfolder', name: 'newfolder', createdAt: new Date() };
    const savedFolder = { ...newFolder, id: '3' };

    component.newFolder = { ...newFolder };
    foldersServiceSpy.addFolder.and.returnValue(of(savedFolder));

    component.addFolder();

    expect(foldersServiceSpy.addFolder).toHaveBeenCalledWith(newFolder);
    expect(component.folders).toContain(savedFolder);
    expect(component.newFolder).not.toEqual(newFolder); // Should be reset
  });

  it('should update a folder', () => {
    const folder = { id: '1', path: '/path/to/folder1', name: 'folder1', createdAt: new Date() };
    const updatedFolder = { ...folder, name: 'updated folder1' };

    component.folders = [folder];
    foldersServiceSpy.updateFolder.and.returnValue(of(updatedFolder));

    component.updateFolder(updatedFolder);

    expect(foldersServiceSpy.updateFolder).toHaveBeenCalledWith(updatedFolder);
    expect(component.folders[0]).toEqual(updatedFolder);
  });

  it('should delete a folder', () => {
    const folder1 = { id: '1', path: '/path/to/folder1', name: 'folder1', createdAt: new Date() };
    const folder2 = { id: '2', path: '/path/to/folder2', name: 'folder2', createdAt: new Date() };

    component.folders = [folder1, folder2];
    foldersServiceSpy.deleteFolder.and.returnValue(of(true));

    component.deleteFolder('1');

    expect(foldersServiceSpy.deleteFolder).toHaveBeenCalledWith('1');
    expect(component.folders.length).toBe(1);
    expect(component.folders[0]).toEqual(folder2);
  });
});
