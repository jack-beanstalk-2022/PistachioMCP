import {
    initializeApp,
    applicationDefault,
    getApps,
    App,
} from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";

function initializeFirebaseApp(): App {
    // Check if app is already initialized
    const existingApps = getApps();
    if (existingApps.length > 0) {
        // Return the first existing app
        return existingApps[0];
    }

    const isDevEnv = process.env.NODE_ENV !== "production";

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
    const now = Timestamp.now();
    const docRef = db.collection(MCP_PROJECTS_COLLECTION).doc();

    const projectData: FirestoreMCPProjectData = {
        name: projectName,
        createdAt: now,
        updatedAt: now,
    };

    await docRef.set(projectData);

    return docRef.id;
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
        console.warn("Failed to upload to GCS:", error);
        return null;
    }
}
