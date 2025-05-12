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

// Save a single indexed file with retry logic
function saveIndexedFile(file, retryCount = 3, retryDelay = 500) {
  return new Promise((resolve, reject) => {
    const { id, folderId, path, filename, content, lastIndexed, lastModified } = file;

    // Function to attempt saving the file with retry logic
    const attemptSave = (attemptsLeft) => {
      try {
        // Convert Date objects to ISO strings with error handling
        const lastIndexedStr = lastIndexed instanceof Date ?
          lastIndexed.toISOString() :
          new Date(lastIndexed || Date.now()).toISOString();

        const lastModifiedStr = lastModified instanceof Date ?
          lastModified.toISOString() :
          new Date(lastModified || Date.now()).toISOString();

        // Use a transaction for data integrity
        db.serialize(() => {
          db.run('BEGIN TRANSACTION', (beginErr) => {
            if (beginErr) {
              console.error('Error beginning transaction:', beginErr.message);
              handleError(beginErr, attemptsLeft);
              return;
            }

            db.run(
              `INSERT OR REPLACE INTO indexed_files (id, folder_id, path, filename, content, last_indexed, last_modified)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [id, folderId, path, filename, content, lastIndexedStr, lastModifiedStr],
              function(err) {
                if (err) {
                  console.error(`Error saving indexed file ${id}:`, err.message);
                  db.run('ROLLBACK', () => {
                    handleError(err, attemptsLeft);
                  });
                } else {
                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      console.error('Error committing transaction:', commitErr.message);
                      db.run('ROLLBACK', () => {
                        handleError(commitErr, attemptsLeft);
                      });
                    } else {
                      resolve({
                        id,
                        changes: this.changes,
                        path,
                        retryAttempts: retryCount - attemptsLeft
                      });
                    }
                  });
                }
              }
            );
          });
        });
      } catch (error) {
        console.error(`Error processing file ${id}:`, error.message);
        handleError(error, attemptsLeft);
      }
    };

    // Function to handle errors and retry if needed
    const handleError = (error, attemptsLeft) => {
      if (attemptsLeft > 0) {
        console.log(`Retrying save for file ${id}, ${attemptsLeft} attempts left...`);
        setTimeout(() => attemptSave(attemptsLeft - 1), retryDelay);
      } else {
        console.error(`Failed to save file ${id} after ${retryCount} attempts:`, error.message);
        reject({
          error: error.message,
          code: error.code || 'UNKNOWN',
          file: {
            id,
            path,
            folderId
          }
        });
      }
    };

    // Start the first attempt
    attemptSave(retryCount);
  });
}

// Save multiple indexed files in a batch with chunking for better performance
function saveIndexedFilesBatch(files) {
  return new Promise((resolve, reject) => {
    if (!files || files.length === 0) {
      resolve({ count: 0 });
      return;
    }

    // Define chunk size to prevent memory issues with large batches
    const CHUNK_SIZE = 500;
    const totalFiles = files.length;
    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;
    let errors = [];

    // Process files in chunks
    const processChunk = async (startIndex) => {
      return new Promise((chunkResolve, chunkReject) => {
        const endIndex = Math.min(startIndex + CHUNK_SIZE, totalFiles);
        const chunk = files.slice(startIndex, endIndex);

        console.log(`Processing chunk of ${chunk.length} files (${startIndex + 1}-${endIndex} of ${totalFiles})`);

        // Use a transaction for better performance
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');

          const stmt = db.prepare(
            `INSERT OR REPLACE INTO indexed_files (id, folder_id, path, filename, content, last_indexed, last_modified)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          );

          let chunkSuccessCount = 0;
          let chunkErrorCount = 0;
          let completed = 0;

          for (const file of chunk) {
            const { id, folderId, path, filename, content, lastIndexed, lastModified } = file;

            try {
              // Convert Date objects to ISO strings with error handling
              const lastIndexedStr = lastIndexed instanceof Date ?
                lastIndexed.toISOString() :
                new Date(lastIndexed || Date.now()).toISOString();

              const lastModifiedStr = lastModified instanceof Date ?
                lastModified.toISOString() :
                new Date(lastModified || Date.now()).toISOString();

              stmt.run([id, folderId, path, filename, content, lastIndexedStr, lastModifiedStr], function(err) {
                completed++;

                if (err) {
                  console.error(`Error in batch save for file ${id}:`, err.message);
                  chunkErrorCount++;
                  errors.push({
                    id,
                    path,
                    error: err.message,
                    code: err.code || 'UNKNOWN'
                  });
                } else {
                  chunkSuccessCount++;
                }

                // Check if all files in this chunk have been processed
                if (completed === chunk.length) {
                  stmt.finalize();

                  db.run('COMMIT', function(err) {
                    if (err) {
                      console.error('Error committing transaction:', err.message);
                      db.run('ROLLBACK', () => {
                        chunkReject(err);
                      });
                    } else {
                      successCount += chunkSuccessCount;
                      errorCount += chunkErrorCount;
                      processedCount += chunk.length;

                      console.log(`Chunk completed: ${chunkSuccessCount} succeeded, ${chunkErrorCount} failed`);
                      chunkResolve({
                        processedCount,
                        successCount,
                        errorCount
                      });
                    }
                  });
                }
              });
            } catch (err) {
              completed++;
              chunkErrorCount++;
              console.error(`Error processing file ${file.id || 'unknown'}:`, err.message);
              errors.push({
                id: file.id || 'unknown',
                path: file.path || 'unknown',
                error: err.message,
                code: 'PROCESSING_ERROR'
              });

              // Check if all files in this chunk have been processed
              if (completed === chunk.length) {
                stmt.finalize();

                db.run('COMMIT', function(err) {
                  if (err) {
                    console.error('Error committing transaction:', err.message);
                    db.run('ROLLBACK', () => {
                      chunkReject(err);
                    });
                  } else {
                    successCount += chunkSuccessCount;
                    errorCount += chunkErrorCount;
                    processedCount += chunk.length;

                    console.log(`Chunk completed: ${chunkSuccessCount} succeeded, ${chunkErrorCount} failed`);
                    chunkResolve({
                      processedCount,
                      successCount,
                      errorCount
                    });
                  }
                });
              }
            }
          }
        });
      });
    };

    // Process all chunks sequentially
    const processAllChunks = async () => {
      try {
        for (let i = 0; i < totalFiles; i += CHUNK_SIZE) {
          await processChunk(i);

          // Report progress after each chunk
          console.log(`Progress: ${Math.round((processedCount / totalFiles) * 100)}% (${processedCount}/${totalFiles})`);
        }

        resolve({
          count: successCount,
          errors: errorCount,
          errorDetails: errors.length > 0 ? errors : undefined
        });
      } catch (err) {
        console.error('Error processing file chunks:', err.message);
        reject(err);
      }
    };

    // Start processing
    processAllChunks();
  });
}

// Remove a file from the index with transaction support
function removeFileFromIndex(filePath, folderId) {
  return new Promise((resolve, reject) => {
    // Use a transaction for data integrity
    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          console.error('Error beginning transaction:', err.message);
          reject(err);
          return;
        }

        db.run(
          `DELETE FROM indexed_files WHERE path = ? AND folder_id = ?`,
          [filePath, folderId],
          function(err) {
            if (err) {
              console.error(`Error removing file ${filePath} from index:`, err.message);
              db.run('ROLLBACK', () => {
                reject(err);
              });
            } else {
              db.run('COMMIT', (commitErr) => {
                if (commitErr) {
                  console.error('Error committing transaction:', commitErr.message);
                  db.run('ROLLBACK', () => {
                    reject(commitErr);
                  });
                } else {
                  resolve({
                    removed: this.changes > 0,
                    count: this.changes,
                    path: filePath,
                    folderId: folderId
                  });
                }
              });
            }
          }
        );
      });
    });
  });
}

// Remove all files for a specific folder with transaction support
function removeFolderFromIndex(folderId) {
  return new Promise((resolve, reject) => {
    // Use a transaction for data integrity
    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          console.error('Error beginning transaction:', err.message);
          reject(err);
          return;
        }

        // First count the files to be removed for logging purposes
        db.get(
          `SELECT COUNT(*) as fileCount FROM indexed_files WHERE folder_id = ?`,
          [folderId],
          (countErr, row) => {
            if (countErr) {
              console.error(`Error counting files for folder ${folderId}:`, countErr.message);
              db.run('ROLLBACK', () => {
                reject(countErr);
              });
              return;
            }

            const fileCount = row ? row.fileCount : 0;
            console.log(`Removing ${fileCount} files for folder ${folderId}`);

            // Then delete the files
            db.run(
              `DELETE FROM indexed_files WHERE folder_id = ?`,
              [folderId],
              function(deleteErr) {
                if (deleteErr) {
                  console.error(`Error removing folder ${folderId} from index:`, deleteErr.message);
                  db.run('ROLLBACK', () => {
                    reject(deleteErr);
                  });
                } else {
                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      console.error('Error committing transaction:', commitErr.message);
                      db.run('ROLLBACK', () => {
                        reject(commitErr);
                      });
                    } else {
                      resolve({
                        removed: this.changes > 0,
                        count: this.changes,
                        folderId: folderId,
                        expectedCount: fileCount
                      });
                    }
                  });
                }
              }
            );
          }
        );
      });
    });
  });
}

// Clear all indexed files from the database with transaction support
function clearAllIndexedFiles() {
  return new Promise((resolve, reject) => {
    // Use a transaction for data integrity
    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          console.error('Error beginning transaction:', err.message);
          reject(err);
          return;
        }

        // First count the files to be removed for logging purposes
        db.get(
          `SELECT COUNT(*) as fileCount FROM indexed_files`,
          (countErr, row) => {
            if (countErr) {
              console.error('Error counting files:', countErr.message);
              db.run('ROLLBACK', () => {
                reject(countErr);
              });
              return;
            }

            const fileCount = row ? row.fileCount : 0;
            console.log(`Clearing all indexed files (${fileCount} files)`);

            // Then delete all files
            db.run(
              `DELETE FROM indexed_files`,
              function(deleteErr) {
                if (deleteErr) {
                  console.error('Error clearing all indexed files:', deleteErr.message);
                  db.run('ROLLBACK', () => {
                    reject(deleteErr);
                  });
                } else {
                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      console.error('Error committing transaction:', commitErr.message);
                      db.run('ROLLBACK', () => {
                        reject(commitErr);
                      });
                    } else {
                      resolve({
                        removed: this.changes > 0,
                        count: this.changes,
                        expectedCount: fileCount
                      });
                    }
                  });
                }
              }
            );
          }
        );
      });
    });
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

// Check database integrity
function checkDatabaseIntegrity(thorough = false) {
  return new Promise((resolve, reject) => {
    console.log(`Checking database integrity (thorough: ${thorough})`);

    // Start with a basic integrity check
    db.get("PRAGMA integrity_check", (err, result) => {
      if (err) {
        console.error('Error running integrity check:', err.message);
        reject(err);
        return;
      }

      const isIntegrityOk = result.integrity_check === 'ok';
      console.log(`Basic integrity check result: ${isIntegrityOk ? 'OK' : 'FAILED'}`);

      // If not thorough or basic check failed, return the result
      if (!thorough || !isIntegrityOk) {
        resolve({
          integrity: isIntegrityOk,
          issues: isIntegrityOk ? [] : [{ type: 'integrity', message: 'Database integrity check failed', count: 1 }]
        });
        return;
      }

      // If thorough, perform additional checks
      const issues = [];

      // Check for orphaned files (files without a valid folder)
      db.all(`
        SELECT COUNT(*) as count
        FROM indexed_files
        WHERE folder_id NOT IN (
          SELECT DISTINCT folder_id FROM indexed_files GROUP BY folder_id
        )
      `, [], (err, orphanedResult) => {
        if (err) {
          console.error('Error checking for orphaned files:', err.message);
          issues.push({ type: 'query', message: `Error checking for orphaned files: ${err.message}`, count: 1 });
        } else if (orphanedResult[0].count > 0) {
          console.log(`Found ${orphanedResult[0].count} orphaned files`);
          issues.push({ type: 'orphaned', message: 'Orphaned files found', count: orphanedResult[0].count });
        }

        // Check for duplicate file paths
        db.all(`
          SELECT path, COUNT(*) as count
          FROM indexed_files
          GROUP BY path
          HAVING count > 1
        `, [], (err, duplicateResult) => {
          if (err) {
            console.error('Error checking for duplicate files:', err.message);
            issues.push({ type: 'query', message: `Error checking for duplicate files: ${err.message}`, count: 1 });
          } else if (duplicateResult.length > 0) {
            const totalDuplicates = duplicateResult.reduce((sum, row) => sum + row.count - 1, 0);
            console.log(`Found ${totalDuplicates} duplicate files (${duplicateResult.length} unique paths)`);
            issues.push({ type: 'duplicate', message: 'Duplicate file paths found', count: totalDuplicates });
          }

          // Check for null or empty content
          db.all(`
            SELECT COUNT(*) as count
            FROM indexed_files
            WHERE content IS NULL OR content = ''
          `, [], (err, emptyResult) => {
            if (err) {
              console.error('Error checking for empty content:', err.message);
              issues.push({ type: 'query', message: `Error checking for empty content: ${err.message}`, count: 1 });
            } else if (emptyResult[0].count > 0) {
              console.log(`Found ${emptyResult[0].count} files with empty content`);
              issues.push({ type: 'empty', message: 'Files with empty content found', count: emptyResult[0].count });
            }

            // Return the final result
            resolve({
              integrity: isIntegrityOk && issues.length === 0,
              issues: issues
            });
          });
        });
      });
    });
  });
}

// Repair database issues
function repairDatabase() {
  return new Promise((resolve, reject) => {
    console.log('Repairing database issues');

    // Start a transaction for all repairs
    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (beginErr) => {
        if (beginErr) {
          console.error('Error beginning repair transaction:', beginErr.message);
          reject(beginErr);
          return;
        }

        let repairedIssues = 0;
        let remainingIssues = 0;

        // Remove orphaned files
        db.run(`
          DELETE FROM indexed_files
          WHERE folder_id NOT IN (
            SELECT DISTINCT folder_id FROM indexed_files GROUP BY folder_id
          )
        `, function(err) {
          if (err) {
            console.error('Error removing orphaned files:', err.message);
            db.run('ROLLBACK', () => {
              reject(err);
            });
            return;
          }

          const orphanedRemoved = this.changes;
          repairedIssues += orphanedRemoved;
          console.log(`Removed ${orphanedRemoved} orphaned files`);

          // Remove duplicate files (keep the most recent version)
          db.run(`
            DELETE FROM indexed_files
            WHERE id IN (
              SELECT a.id
              FROM indexed_files a
              JOIN (
                SELECT path, MIN(id) as keep_id
                FROM indexed_files
                GROUP BY path
                HAVING COUNT(*) > 1
              ) b ON a.path = b.path
              WHERE a.id != b.keep_id
            )
          `, function(err) {
            if (err) {
              console.error('Error removing duplicate files:', err.message);
              db.run('ROLLBACK', () => {
                reject(err);
              });
              return;
            }

            const duplicatesRemoved = this.changes;
            repairedIssues += duplicatesRemoved;
            console.log(`Removed ${duplicatesRemoved} duplicate files`);

            // Commit the transaction
            db.run('COMMIT', (commitErr) => {
              if (commitErr) {
                console.error('Error committing repair transaction:', commitErr.message);
                db.run('ROLLBACK', () => {
                  reject(commitErr);
                });
                return;
              }

              // Check for any remaining issues
              checkDatabaseIntegrity(true).then(result => {
                remainingIssues = result.issues.reduce((sum, issue) => sum + issue.count, 0);

                resolve({
                  repaired: repairedIssues > 0,
                  repairedIssues,
                  remainingIssues,
                  issues: result.issues
                });
              }).catch(checkErr => {
                console.error('Error checking database after repair:', checkErr.message);
                resolve({
                  repaired: repairedIssues > 0,
                  repairedIssues,
                  error: checkErr.message
                });
              });
            });
          });
        });
      });
    });
  });
}

// Optimize database
function optimizeDatabase() {
  return new Promise((resolve, reject) => {
    console.log('Optimizing database');

    // Run VACUUM to reclaim space and defragment the database
    db.run('VACUUM', (err) => {
      if (err) {
        console.error('Error running VACUUM:', err.message);
        reject(err);
        return;
      }

      // Reindex the database to optimize queries
      db.run('REINDEX', (err) => {
        if (err) {
          console.error('Error running REINDEX:', err.message);
          reject(err);
          return;
        }

        // Analyze the database to update statistics
        db.run('ANALYZE', (err) => {
          if (err) {
            console.error('Error running ANALYZE:', err.message);
            reject(err);
            return;
          }

          resolve({
            success: true,
            message: 'Database optimized successfully'
          });
        });
      });
    });
  });
}

// Get database statistics
function getDatabaseStats() {
  return new Promise((resolve, reject) => {
    console.log('Getting database statistics');

    // Get total number of files
    db.get('SELECT COUNT(*) as count FROM indexed_files', (err, totalResult) => {
      if (err) {
        console.error('Error getting total files count:', err.message);
        reject(err);
        return;
      }

      const totalFiles = totalResult.count;

      // Get total number of folders
      db.get('SELECT COUNT(DISTINCT folder_id) as count FROM indexed_files', (err, folderResult) => {
        if (err) {
          console.error('Error getting folder count:', err.message);
          reject(err);
          return;
        }

        const totalFolders = folderResult.count;

        // Get total size of content
        db.get('SELECT SUM(LENGTH(content)) as total_size FROM indexed_files', (err, sizeResult) => {
          if (err) {
            console.error('Error getting content size:', err.message);
            reject(err);
            return;
          }

          const totalSize = sizeResult.total_size || 0;

          // Check for any issues
          checkDatabaseIntegrity(false).then(integrityResult => {
            resolve({
              totalFiles,
              totalFolders,
              totalSize,
              lastUpdated: new Date(),
              integrityStatus: integrityResult.integrity ? 'ok' : 'warning',
              issues: integrityResult.issues
            });
          }).catch(integrityErr => {
            console.error('Error checking integrity for stats:', integrityErr.message);
            resolve({
              totalFiles,
              totalFolders,
              totalSize,
              lastUpdated: new Date(),
              integrityStatus: 'error',
              issues: [{ type: 'integrity', message: `Error checking integrity: ${integrityErr.message}`, count: 1 }]
            });
          });
        });
      });
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
  checkDatabaseIntegrity,
  repairDatabase,
  optimizeDatabase,
  getDatabaseStats,
  closeDatabase
};
