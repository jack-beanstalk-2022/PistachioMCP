import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator, Firestore, Timestamp, collection, doc, setDoc, updateDoc } from "firebase/firestore";
import { getAuth, connectAuthEmulator, signInAnonymously, Auth } from "firebase/auth";
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";
import { logger } from "./Logger.js";

// Firebase configuration interface
interface FirebaseConfig {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId?: string;
    measurementId?: string;
}

// Global variables for Firebase app, auth, and firestore
let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let authInitialized = false;

/**
 * Firebase configuration
 */
const firebaseConfig: FirebaseConfig = {
    apiKey: "AIzaSyDjg3R6uloREIFpK3BVH9_jRXLALsS6PZ0",
    authDomain: "adept-bastion-482216-k1.firebaseapp.com",
    projectId: "adept-bastion-482216-k1",
    storageBucket: "adept-bastion-482216-k1.firebasestorage.app",
    messagingSenderId: "511506915846",
    appId: "1:511506915846:web:77084d165e9a197210d987",
    measurementId: "G-3GHH7D20ES",
};

/**
 * Initialize Firebase app and authenticate anonymously
 */
async function initializeFirebaseApp(): Promise<FirebaseApp> {
    // Check if app is already initialized
    const existingApps = getApps();
    if (existingApps.length > 0) {
        app = existingApps[0];
        // Ensure auth and db are initialized
        if (!auth) {
            auth = getAuth(app);
        }
        if (!db) {
            db = getFirestore(app);
        }
        // Ensure authentication is done
        if (!authInitialized) {
            await ensureAuthenticated();
        }
        return app;
    }

    // Initialize the app
    app = initializeApp(firebaseConfig);

    // Initialize Auth
    auth = getAuth(app);

    // Configure Auth emulator only if explicitly requested via environment variable
    const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    if (authEmulatorHost) {
        try {
            console.log(`Connecting to Auth emulator at http://${authEmulatorHost}`);
            connectAuthEmulator(auth, `http://${authEmulatorHost}`, { disableWarnings: true });
        } catch (error) {
            // Emulator already connected, ignore
            if (error instanceof Error && !error.message.includes("already been initialized")) {
                console.warn("Failed to connect to Auth emulator:", error);
                throw error;
            }
        }
    }

    // Initialize Firestore
    db = getFirestore(app);

    // Configure Firestore emulator only if explicitly requested via environment variable
    const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
    if (firestoreEmulatorHost) {
        const [host, port] = firestoreEmulatorHost.split(":");
        try {
            console.log(`Connecting to Firestore emulator at ${host}:${port}`);
            connectFirestoreEmulator(db, host, parseInt(port, 10));
        } catch (error) {
            // Emulator already connected, ignore
            if (error instanceof Error && !error.message.includes("already been initialized")) {
                console.warn("Failed to connect to Firestore emulator:", error);
                throw error;
            }
        }
    }

    // Authenticate anonymously
    await ensureAuthenticated();

    return app;
}

/**
 * Ensure user is authenticated (sign in anonymously if not)
 */
async function ensureAuthenticated(): Promise<void> {
    if (!auth) {
        throw new Error("Auth not initialized. Call initializeFirebaseApp() first.");
    }

    if (authInitialized) {
        return;
    }

    // Check if user is already signed in
    if (auth.currentUser) {
        authInitialized = true;
        return;
    }

    // Sign in anonymously
    try {
        await signInAnonymously(auth);
        authInitialized = true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

        if (authEmulatorHost) {
            // Using emulator - use console for local development
            console.error(`Firebase Auth Error: ${errorMessage}`);
        } else {
            // Production - use structured logging
            logger.error({
                error_message: errorMessage,
                stack: errorStack,
                auth_mode: "production",
            }, "Firebase Auth Error");
        }

        throw new Error(`Failed to authenticate anonymously: ${errorMessage}`);
    }
}

/**
 * Get initialized Firebase app (initializes if needed)
 */
export async function getFirebaseApp(): Promise<FirebaseApp> {
    if (!app) {
        return await initializeFirebaseApp();
    }
    if (!authInitialized) {
        await ensureAuthenticated();
    }
    return app;
}

/**
 * Get initialized Firestore instance (initializes if needed)
 */
export async function getFirestoreDb(): Promise<Firestore> {
    if (!db) {
        await initializeFirebaseApp();
    }
    if (!db) {
        throw new Error("Failed to initialize Firestore");
    }
    if (!authInitialized) {
        await ensureAuthenticated();
    }
    return db;
}

// ============================================================================
// MCP Project Operations
// ============================================================================

const MCP_PROJECTS_COLLECTION = "mcpProjects";

/**
 * Firestore document data for an MCP project (as stored in Firestore)
 */
interface FirestoreMCPProjectData {
    name: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

/**
 * Create a new MCP project entry in Firestore
 * @param projectName - Name of the project
 * @returns The created project ID
 */
export async function createMCPProject(
    projectName: string
): Promise<string> {
    const firestore = await getFirestoreDb();
    const now = Timestamp.now();

    // Use client SDK modular API: collection() and doc() with auto-generated ID
    const collectionRef = collection(firestore, MCP_PROJECTS_COLLECTION);
    const docRef = doc(collectionRef);

    const projectData: FirestoreMCPProjectData = {
        name: projectName,
        createdAt: now,
        updatedAt: now,
    };

    await setDoc(docRef, projectData);

    return docRef.id;
}

/**
 * Update the updatedAt timestamp for a project
 * @param projectId - The ID of the project to update
 */
export async function updateProjectTimestamp(
    projectId: string
): Promise<void> {
    const firestore = await getFirestoreDb();
    const now = Timestamp.now();

    const docRef = doc(firestore, MCP_PROJECTS_COLLECTION, projectId);

    await updateDoc(docRef, {
        updatedAt: now,
    });
}

// ============================================================================
// GCS Upload Operations
// ============================================================================

/**
 * Upload a base64 PNG image to GCS and return the public URL
 * Uses WEEKLY_EXPIRING bucket for temporary storage
 */
export async function uploadToGCSWeeklyExpiring(
    base64: string,
    userId: string
): Promise<string | null> {
    try {
        // Convert base64 to buffer
        const buffer = Buffer.from(base64, "base64");
        const mimeType = "image/png";

        // Initialize GCS storage
        const storage = new Storage();

        // Use WEEKLY_EXPIRING bucket for temporary storage
        const bucketName =
            process.env.GCS_BUCKET_WEEKLY_EXPIRING ||
            "dev-pistachio-assets-weekly-expiring";

        // Strip gs:// prefix if present
        let finalBucketName = bucketName;
        if (finalBucketName.startsWith("gs://")) {
            finalBucketName = finalBucketName.substring(5);
        }
        const bucket = storage.bucket(finalBucketName);

        // Generate filename with extension
        const extension = mimeType.split("/")[1] || "png";
        const filename = `${randomUUID()}.${extension}`;
        const file = bucket.file(`${userId}/${filename}`);

        // Upload the buffer to GCS
        await file.save(buffer, {
            metadata: {
                contentType: mimeType,
            },
        });

        // Return the public URL
        const publicUrl = `https://storage.googleapis.com/${finalBucketName}/${userId}/${filename}`;
        return publicUrl;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn({
            error_message: errorMessage,
            user_id: userId,
        }, "Failed to upload to GCS");
        return null;
    }
}
