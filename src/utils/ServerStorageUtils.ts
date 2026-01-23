import {
    initializeApp,
    applicationDefault,
    getApps,
    App,
} from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

function initializeFirebaseApp(): App {
    // Check if app is already initialized
    const existingApps = getApps();
    if (existingApps.length > 0) {
        // Return the first existing app
        return existingApps[0];
    }

    const isDevEnv = process.env.NODE_ENV === "development";

    // Set project ID in environment if not present,
    // as some SDK components (like applicationDefault) might look for it
    if (!process.env.GCLOUD_PROJECT) {
        process.env.GCLOUD_PROJECT = "adept-bastion-482216-k1";
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT) {
        process.env.GOOGLE_CLOUD_PROJECT = "adept-bastion-482216-k1";
    }

    // Configure Firestore emulator for dev environment
    // The Admin SDK automatically uses FIRESTORE_EMULATOR_HOST
    if (isDevEnv && !process.env.FIRESTORE_EMULATOR_HOST) {
        process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
    }

    // Configure Auth emulator for dev environment
    // The Admin SDK automatically uses FIREBASE_AUTH_EMULATOR_HOST
    if (isDevEnv && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
    }

    // Initialize the app
    const app = initializeApp({
        credential: applicationDefault(),
    });

    return app;
}

// Initialize Firebase app
export const app = initializeFirebaseApp();
export const db = getFirestore(app);

/**
 * Get or set cached data from Firestore
 * @param collectionName - The Firestore collection name
 * @param cacheKey - The document ID / cache key
 * @param fetchFn - Function to fetch fresh data if cache is expired/missing
 * @param cacheDurationMs - Cache duration in milliseconds (default: 12 months)
 * @returns The cached or freshly fetched data
 */
export async function getCachedData<T>(
    collectionName: string,
    cacheKey: string,
    fetchFn: () => Promise<T>,
    cacheDurationMs: number = 12 * 30 * 24 * 60 * 60 * 1000 // 12 months
): Promise<T> {
    const docRef = db.collection(collectionName).doc(cacheKey);
    const doc = await docRef.get();

    const now = new Date();

    if (doc.exists) {
        const data = doc.data();
        if (data) {
            const expiresAt =
                data.expiresAt instanceof Timestamp
                    ? data.expiresAt.toDate()
                    : new Date(data.expiresAt as string | number | Date);

            // Check if cache is still valid
            if (expiresAt > now) {
                // Return cached data (excluding metadata)
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { createdAt, expiresAt, ...cachedData } = data;
                return cachedData as T;
            }
        }
    }

    // Cache miss or expired - fetch fresh data
    const freshData = await fetchFn();

    // Store in cache
    const expiresAt = new Date(now.getTime() + cacheDurationMs);

    await docRef.set({
        ...freshData,
        createdAt: now,
        expiresAt,
    });

    return freshData;
}
