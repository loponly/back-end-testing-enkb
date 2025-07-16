/**
 * Firestore Test Wrapper
 * 
 * Utility class for managing Firestore emulator during tests
 */

import { initializeApp, deleteApp, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore, connectFirestoreEmulator } from 'firebase-admin/firestore';
import { execSync } from 'child_process';

export class FirestoreTestWrapper {
  public app: App | null = null;
  public db: Firestore | null = null;
  public admin: any;

  async setup(): Promise<void> {
    try {
      // Start Firestore emulator if not already running
      try {
        execSync('firebase emulators:start --only firestore --project test-project &', { 
          stdio: 'ignore',
          timeout: 5000 
        });
      } catch (error) {
        // Emulator might already be running
      }

      // Clear any existing apps
      const existingApps = getApps();
      await Promise.all(existingApps.map(app => deleteApp(app)));

      // Initialize test app
      this.app = initializeApp({ projectId: 'test-project' }, 'test-app');
      this.db = getFirestore(this.app);

      // Connect to emulator
      try {
        connectFirestoreEmulator(this.db, 'localhost', 8080);
      } catch (error) {
        // Already connected
      }

      // Import admin for Timestamp
      this.admin = await import('firebase-admin');
    } catch (error) {
      console.error('Failed to setup Firestore test wrapper:', error);
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    if (this.app) {
      await deleteApp(this.app);
      this.app = null;
      this.db = null;
    }
  }

  async clearData(): Promise<void> {
    if (!this.db) return;

    const collections = await this.db.listCollections();
    const deletePromises = collections.map(async (collection) => {
      const docs = await collection.listDocuments();
      return Promise.all(docs.map(doc => doc.delete()));
    });

    await Promise.all(deletePromises);
  }
}
