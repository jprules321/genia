import { TestBed } from '@angular/core/testing';
import { FoldersService } from './folders.service';
import { Folder } from '../components/folders/folders.component';

describe('FoldersService', () => {
  let service: FoldersService;
  let localStorageSpy: jasmine.SpyObj<Storage>;

  // Sample test data
  const testFolders: Folder[] = [
    { id: '1', path: '/path/to/folder1', name: 'folder1', createdAt: new Date() },
    { id: '2', path: '/path/to/folder2', name: 'folder2', createdAt: new Date() }
  ];

  beforeEach(() => {
    // Create a spy for localStorage
    localStorageSpy = jasmine.createSpyObj('localStorage', ['getItem', 'setItem']);

    // Mock the global localStorage object
    spyOn(localStorage, 'getItem').and.callFake(localStorageSpy.getItem);
    spyOn(localStorage, 'setItem').and.callFake(localStorageSpy.setItem);

    TestBed.configureTestingModule({
      providers: [FoldersService]
    });

    service = TestBed.inject(FoldersService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getFolders', () => {
    it('should return an empty array when localStorage is empty', (done) => {
      localStorage.getItem.and.returnValue(null);

      service.getFolders().subscribe(folders => {
        expect(folders).toEqual([]);
        expect(localStorage.getItem).toHaveBeenCalledWith('genia_folders');
        done();
      });
    });

    it('should return folders from localStorage', (done) => {
      localStorage.getItem.and.returnValue(JSON.stringify(testFolders));

      service.getFolders().subscribe(folders => {
        expect(folders).toEqual(testFolders);
        expect(localStorage.getItem).toHaveBeenCalledWith('genia_folders');
        done();
      });
    });

    it('should handle JSON parse errors', (done) => {
      localStorage.getItem.and.returnValue('invalid json');

      service.getFolders().subscribe(folders => {
        expect(folders).toEqual([]);
        expect(localStorage.getItem).toHaveBeenCalledWith('genia_folders');
        done();
      });
    });
  });

  describe('addFolder', () => {
    it('should add a folder to localStorage', (done) => {
      const newFolder: Folder = { id: '', path: '/path/to/newfolder', name: 'newfolder', createdAt: new Date() };

      localStorage.getItem.and.returnValue(JSON.stringify(testFolders));

      service.addFolder(newFolder).subscribe(folder => {
        expect(folder.id).toBeTruthy(); // Should have generated an ID
        expect(folder.path).toEqual(newFolder.path);
        expect(folder.name).toEqual(newFolder.name);

        // Verify localStorage was updated with the new folder
        const expectedFolders = [...testFolders, folder];
        expect(localStorage.setItem).toHaveBeenCalledWith('genia_folders', JSON.stringify(expectedFolders));

        done();
      });
    });
  });

  describe('updateFolder', () => {
    it('should update an existing folder', (done) => {
      const updatedFolder: Folder = { ...testFolders[0], name: 'updated folder1' };

      localStorage.getItem.and.returnValue(JSON.stringify(testFolders));

      service.updateFolder(updatedFolder).subscribe(folder => {
        expect(folder).toEqual(updatedFolder);

        // Verify localStorage was updated with the updated folder
        const expectedFolders = [...testFolders];
        expectedFolders[0] = updatedFolder;
        expect(localStorage.setItem).toHaveBeenCalledWith('genia_folders', JSON.stringify(expectedFolders));

        done();
      });
    });

    it('should throw an error when updating a non-existent folder', (done) => {
      const nonExistentFolder: Folder = { id: 'non-existent', path: '/path', name: 'non-existent', createdAt: new Date() };

      localStorage.getItem.and.returnValue(JSON.stringify(testFolders));

      service.updateFolder(nonExistentFolder).subscribe(
        () => {
          fail('Should have thrown an error');
          done();
        },
        error => {
          expect(error.message).toContain('not found');
          done();
        }
      );
    });
  });

  describe('deleteFolder', () => {
    it('should delete a folder', (done) => {
      localStorage.getItem.and.returnValue(JSON.stringify(testFolders));

      service.deleteFolder('1').subscribe(success => {
        expect(success).toBe(true);

        // Verify localStorage was updated without the deleted folder
        const expectedFolders = testFolders.filter(f => f.id !== '1');
        expect(localStorage.setItem).toHaveBeenCalledWith('genia_folders', JSON.stringify(expectedFolders));

        done();
      });
    });
  });

  describe('getFolder', () => {
    it('should return a folder by ID', (done) => {
      localStorage.getItem.and.returnValue(JSON.stringify(testFolders));

      service.getFolder('1').subscribe(folder => {
        expect(folder).toEqual(testFolders[0]);
        done();
      });
    });

    it('should return null for a non-existent folder ID', (done) => {
      localStorage.getItem.and.returnValue(JSON.stringify(testFolders));

      service.getFolder('non-existent').subscribe(folder => {
        expect(folder).toBeNull();
        done();
      });
    });
  });
});
