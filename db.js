const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

// Get the user data directory
const userDataPath = app.getPath('userData');
const dbDir = path.join(userDataPath, 'database');
const dbPath = path.join(dbDir, 'indexed_files.db');

// Ensure the database directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Create or open the database
let db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the indexed files database.');
    // Create tables if they don't exist
    initDatabase();
  }
});

// Initialize the database schema
function initDatabase() {
  db.serialize(() => {
    // Create indexed_files table
    db.run(`CREATE TABLE IF NOT EXISTS indexed_files (
      id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL,
      path TEXT NOT NULL,
      filename TEXT NOT NULL,
      content TEXT,
      last_indexed TEXT,
      last_modified TEXT
    )`, (err) => {
      if (err) {
        console.error('Error creating indexed_files table:', err.message);
      } else {
        console.log('Indexed files table ready.');
      }
    });

    // Create index on folder_id for faster queries
    db.run(`CREATE INDEX IF NOT EXISTS idx_folder_id ON indexed_files(folder_id)`, (err) => {
      if (err) {
        console.error('Error creating index on folder_id:', err.message);
      }
    });

    // Create index on path for faster lookups
    db.run(`CREATE INDEX IF NOT EXISTS idx_path ON indexed_files(path)`, (err) => {
      if (err) {
        console.error('Error creating index on path:', err.message);
      }
    });
  });
}

// Get all indexed files
function getAllIndexedFiles() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM indexed_files`, [], (err, rows) => {
      if (err) {
        console.error('Error getting all indexed files:', err.message);
        reject(err);
      } else {
        // Convert date strings to Date objects
        const files = rows.map(row => ({
          id: row.id,
          folderId: row.folder_id,
          path: row.path,
          filename: row.filename,
          content: row.content,
          lastIndexed: new Date(row.last_indexed),
          lastModified: new Date(row.last_modified)
        }));
        resolve(files);
      }
    });
  });
}

// Get indexed files for a specific folder
function getIndexedFilesForFolder(folderId) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM indexed_files WHERE folder_id = ?`, [folderId], (err, rows) => {
      if (err) {
        console.error(`Error getting indexed files for folder ${folderId}:`, err.message);
        reject(err);
      } else {
        // Convert date strings to Date objects
        const files = rows.map(row => ({
          id: row.id,
          folderId: row.folder_id,
          path: row.path,
          filename: row.filename,
          content: row.content,
          lastIndexed: new Date(row.last_indexed),
          lastModified: new Date(row.last_modified)
        }));
        resolve(files);
      }
    });
  });
}

// Save a single indexed file
function saveIndexedFile(file) {
  return new Promise((resolve, reject) => {
    const { id, folderId, path, filename, content, lastIndexed, lastModified } = file;

    // Convert Date objects to ISO strings
    const lastIndexedStr = lastIndexed instanceof Date ? lastIndexed.toISOString() : new Date(lastIndexed).toISOString();
    const lastModifiedStr = lastModified instanceof Date ? lastModified.toISOString() : new Date(lastModified).toISOString();

    db.run(
      `INSERT OR REPLACE INTO indexed_files (id, folder_id, path, filename, content, last_indexed, last_modified)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, folderId, path, filename, content, lastIndexedStr, lastModifiedStr],
      function(err) {
        if (err) {
          console.error(`Error saving indexed file ${id}:`, err.message);
          reject(err);
        } else {
          resolve({ id, changes: this.changes });
        }
      }
    );
  });
}

// Save multiple indexed files in a batch
function saveIndexedFilesBatch(files) {
  return new Promise((resolve, reject) => {
    if (!files || files.length === 0) {
      resolve({ count: 0 });
      return;
    }

    // Use a transaction for better performance
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      let successCount = 0;
      let errorCount = 0;

      const stmt = db.prepare(
        `INSERT OR REPLACE INTO indexed_files (id, folder_id, path, filename, content, last_indexed, last_modified)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      for (const file of files) {
        const { id, folderId, path, filename, content, lastIndexed, lastModified } = file;

        // Convert Date objects to ISO strings
        const lastIndexedStr = lastIndexed instanceof Date ? lastIndexed.toISOString() : new Date(lastIndexed).toISOString();
        const lastModifiedStr = lastModified instanceof Date ? lastModified.toISOString() : new Date(lastModified).toISOString();

        stmt.run([id, folderId, path, filename, content, lastIndexedStr, lastModifiedStr], function(err) {
          if (err) {
            console.error(`Error in batch save for file ${id}:`, err.message);
            errorCount++;
          } else {
            successCount++;
          }
        });
      }

      stmt.finalize();

      db.run('COMMIT', function(err) {
        if (err) {
          console.error('Error committing transaction:', err.message);
          db.run('ROLLBACK');
          reject(err);
        } else {
          resolve({ count: successCount, errors: errorCount });
        }
      });
    });
  });
}

// Remove a file from the index
function removeFileFromIndex(filePath, folderId) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM indexed_files WHERE path = ? AND folder_id = ?`,
      [filePath, folderId],
      function(err) {
        if (err) {
          console.error(`Error removing file ${filePath} from index:`, err.message);
          reject(err);
        } else {
          resolve({ removed: this.changes > 0, count: this.changes });
        }
      }
    );
  });
}

// Remove all files for a specific folder
function removeFolderFromIndex(folderId) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM indexed_files WHERE folder_id = ?`,
      [folderId],
      function(err) {
        if (err) {
          console.error(`Error removing folder ${folderId} from index:`, err.message);
          reject(err);
        } else {
          resolve({ removed: this.changes > 0, count: this.changes });
        }
      }
    );
  });
}

// Clear all indexed files from the database
function clearAllIndexedFiles() {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM indexed_files`,
      function(err) {
        if (err) {
          console.error('Error clearing all indexed files:', err.message);
          reject(err);
        } else {
          resolve({ removed: this.changes > 0, count: this.changes });
        }
      }
    );
  });
}

// Close the database connection
function closeDatabase() {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err.message);
        reject(err);
      } else {
        console.log('Database connection closed.');
        resolve();
      }
    });
  });
}

// Export the database functions
module.exports = {
  getAllIndexedFiles,
  getIndexedFilesForFolder,
  saveIndexedFile,
  saveIndexedFilesBatch,
  removeFileFromIndex,
  removeFolderFromIndex,
  clearAllIndexedFiles,
  closeDatabase
};
