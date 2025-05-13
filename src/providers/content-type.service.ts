import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { IndexingSettingsService } from './indexing-settings.service';

/**
 * Interface for content type information
 */
export interface ContentTypeInfo {
  mimeType: string;
  extension: string;
  category: 'document' | 'image' | 'video' | 'audio' | 'archive' | 'code' | 'other';
  isText: boolean;
  isIndexable: boolean;
  maxSizeBytes?: number; // Maximum size for indexing
}

/**
 * Service responsible for detecting and handling content types
 * This service is used to improve indexing by allowing different file types to be processed differently
 */
@Injectable({
  providedIn: 'root'
})
export class ContentTypeService {
  // Map of file extensions to content type information
  private contentTypeMap: Map<string, ContentTypeInfo> = new Map();

  constructor(private indexingSettingsService: IndexingSettingsService) {
    this.initializeContentTypeMap();
  }

  /**
   * Initialize the content type map with common file types
   */
  private initializeContentTypeMap(): void {
    // Get settings for max file size
    const settings = this.indexingSettingsService.getSettings();
    const defaultMaxSizeBytes = settings.maxFileSizeBytes;

    // Use 50% of max file size for text files and 100% for binary files
    const textFileMaxSize = Math.min(10 * 1024 * 1024, defaultMaxSizeBytes); // Cap at 10MB or user setting
    const binaryFileMaxSize = defaultMaxSizeBytes;
    // Text documents
    this.registerContentType({
      mimeType: 'text/plain',
      extension: 'txt',
      category: 'document',
      isText: true,
      isIndexable: true,
      maxSizeBytes: textFileMaxSize
    });

    this.registerContentType({
      mimeType: 'text/markdown',
      extension: 'md',
      category: 'document',
      isText: true,
      isIndexable: true,
      maxSizeBytes: textFileMaxSize
    });

    // HTML documents
    this.registerContentType({
      mimeType: 'text/html',
      extension: 'html',
      category: 'document',
      isText: true,
      isIndexable: true,
      maxSizeBytes: textFileMaxSize
    });

    // PDF documents
    this.registerContentType({
      mimeType: 'application/pdf',
      extension: 'pdf',
      category: 'document',
      isText: false,
      isIndexable: true,
      maxSizeBytes: binaryFileMaxSize
    });

    // Microsoft Office documents
    this.registerContentType({
      mimeType: 'application/msword',
      extension: 'doc',
      category: 'document',
      isText: false,
      isIndexable: true,
      maxSizeBytes: binaryFileMaxSize
    });

    this.registerContentType({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
      category: 'document',
      isText: false,
      isIndexable: true,
      maxSizeBytes: binaryFileMaxSize
    });

    this.registerContentType({
      mimeType: 'application/vnd.ms-excel',
      extension: 'xls',
      category: 'document',
      isText: false,
      isIndexable: true,
      maxSizeBytes: binaryFileMaxSize
    });

    this.registerContentType({
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
      category: 'document',
      isText: false,
      isIndexable: true,
      maxSizeBytes: binaryFileMaxSize
    });

    this.registerContentType({
      mimeType: 'application/vnd.ms-powerpoint',
      extension: 'ppt',
      category: 'document',
      isText: false,
      isIndexable: true,
      maxSizeBytes: binaryFileMaxSize
    });

    this.registerContentType({
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      extension: 'pptx',
      category: 'document',
      isText: false,
      isIndexable: true,
      maxSizeBytes: binaryFileMaxSize
    });

    // Images
    this.registerContentType({
      mimeType: 'image/jpeg',
      extension: 'jpg',
      category: 'image',
      isText: false,
      isIndexable: false
    });

    this.registerContentType({
      mimeType: 'image/png',
      extension: 'png',
      category: 'image',
      isText: false,
      isIndexable: false
    });

    this.registerContentType({
      mimeType: 'image/gif',
      extension: 'gif',
      category: 'image',
      isText: false,
      isIndexable: false
    });

    // Code files
    this.registerContentType({
      mimeType: 'text/javascript',
      extension: 'js',
      category: 'code',
      isText: true,
      isIndexable: true,
      maxSizeBytes: textFileMaxSize
    });

    this.registerContentType({
      mimeType: 'text/typescript',
      extension: 'ts',
      category: 'code',
      isText: true,
      isIndexable: true,
      maxSizeBytes: textFileMaxSize
    });

    this.registerContentType({
      mimeType: 'text/css',
      extension: 'css',
      category: 'code',
      isText: true,
      isIndexable: true,
      maxSizeBytes: textFileMaxSize
    });

    this.registerContentType({
      mimeType: 'application/json',
      extension: 'json',
      category: 'code',
      isText: true,
      isIndexable: true,
      maxSizeBytes: textFileMaxSize
    });

    this.registerContentType({
      mimeType: 'text/xml',
      extension: 'xml',
      category: 'code',
      isText: true,
      isIndexable: true,
      maxSizeBytes: textFileMaxSize
    });

    // Add more content types as needed
  }

  /**
   * Register a content type
   * @param contentType The content type information
   */
  registerContentType(contentType: ContentTypeInfo): void {
    this.contentTypeMap.set(contentType.extension.toLowerCase(), contentType);
  }

  /**
   * Get content type information for a file
   * @param filePath Path of the file
   */
  getContentTypeInfo(filePath: string): Observable<ContentTypeInfo> {
    try {
      const extension = filePath.split('.').pop()?.toLowerCase() || '';
      const contentType = this.contentTypeMap.get(extension);

      if (contentType) {
        return of(contentType);
      } else {
        // Default to plain text for unknown extensions
        return of({
          mimeType: 'application/octet-stream',
          extension: extension || 'bin',
          category: 'other',
          isText: false,
          isIndexable: false
        });
      }
    } catch (error) {
      console.error(`Error getting content type for file ${filePath}:`, error);
      return of({
        mimeType: 'application/octet-stream',
        extension: 'bin',
        category: 'other',
        isText: false,
        isIndexable: false
      });
    }
  }

  /**
   * Check if a file is indexable based on its content type and size
   * @param filePath Path of the file
   * @param fileSize Size of the file in bytes
   */
  isFileIndexable(filePath: string, fileSize: number): Observable<{ indexable: boolean, reason?: string }> {
    // Get the global max file size setting
    const settings = this.indexingSettingsService.getSettings();
    const globalMaxFileSize = settings.maxFileSizeBytes;

    // Check if file exceeds the global max file size setting
    if (fileSize > globalMaxFileSize) {
      return of({
        indexable: false,
        reason: `File size (${fileSize} bytes) exceeds maximum size setting (${globalMaxFileSize} bytes)`
      });
    }

    return this.getContentTypeInfo(filePath).pipe(
      map(contentType => {
        if (!contentType.isIndexable) {
          return {
            indexable: false,
            reason: `File type ${contentType.extension} is not indexable`
          };
        }

        if (contentType.maxSizeBytes && fileSize > contentType.maxSizeBytes) {
          return {
            indexable: false,
            reason: `File size (${fileSize} bytes) exceeds maximum size for this file type (${contentType.maxSizeBytes} bytes)`
          };
        }

        return {
          indexable: true
        };
      }),
      catchError(error => {
        console.error(`Error checking if file ${filePath} is indexable:`, error);
        return of({
          indexable: false,
          reason: `Error checking if file is indexable: ${error.toString()}`
        });
      })
    );
  }

  /**
   * Get all registered content types
   */
  getAllContentTypes(): ContentTypeInfo[] {
    return Array.from(this.contentTypeMap.values());
  }

  /**
   * Get all indexable content types
   */
  getIndexableContentTypes(): ContentTypeInfo[] {
    return this.getAllContentTypes().filter(contentType => contentType.isIndexable);
  }
}
