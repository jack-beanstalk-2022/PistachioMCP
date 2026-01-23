import { getCachedData } from "./ServerStorageUtils.js";

// Unsplash API response types
interface UnsplashPhoto {
    id: string;
    width: number;
    height: number;
    description: string | null;
    alt_description: string | null;
    urls: {
        raw: string;
        full: string;
        regular: string;
        small: string;
        thumb: string;
    };
}

interface UnsplashSearchResponse {
    total: number;
    total_pages: number;
    results: UnsplashPhoto[];
}

// Image size options
export type ImageSize = "regular" | "small" | "thumb";

// Our response image format
export interface ImageResult {
    url: string;
    description: string;
    width: number;
    height: number;
}

// Internal cached format with all URL sizes
interface CachedImageResult {
    urls: {
        regular: string;
        small: string;
        thumb: string;
    };
    description: string;
    width: number;
    height: number;
}

// Generate cache key from query and orientation
export function generateCacheKey(query: string, orientation: string): string {
    return `${query}|${orientation}`;
}

// Fetch images from Unsplash API
async function fetchFromUnsplash(
    query: string,
    orientation: string
): Promise<CachedImageResult[]> {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
        throw new Error("UNSPLASH_ACCESS_KEY environment variable is not set");
    }

    // Build query parameters
    const params = new URLSearchParams({
        query,
        per_page: "30",
        page: "1",
        orientation,
    });

    const url = `https://api.unsplash.com/search/photos?${params.toString()}`;

    const response = await fetch(url, {
        headers: {
            Authorization: `Client-ID ${accessKey}`,
        },
    });

    if (!response.ok) {
        if (response.status === 429) {
            throw new Error("Unsplash API rate limit exceeded");
        }
        throw new Error(`Unsplash API error: ${response.status}`);
    }

    const data = (await response.json()) as UnsplashSearchResponse;

    // Transform to our format - save all URL sizes
    return data.results.map((photo) => ({
        urls: {
            regular: photo.urls.regular,
            small: photo.urls.small,
            thumb: photo.urls.thumb,
        },
        description: photo.description || photo.alt_description || "",
        width: photo.width,
        height: photo.height,
    }));
}

// Get images from cache or fetch from Unsplash
export async function getImages(
    query: string,
    limit: number,
    orientation: string,
    imageSize: ImageSize
): Promise<ImageResult[]> {
    // Validate inputs and throw errors for invalid values
    if (typeof query !== "string" || query.trim().length === 0) {
        throw new Error("Invalid keyword: must be a non-empty string");
    }

    if (
        typeof limit !== "number" ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 30
    ) {
        throw new Error("Invalid limit: must be an integer between 1 and 30");
    }

    const validOrientations = ["landscape", "portrait", "squarish"];
    if (
        typeof orientation !== "string" ||
        !validOrientations.includes(orientation)
    ) {
        throw new Error(
            `Invalid orientation: must be one of ${validOrientations.join(", ")}`
        );
    }

    const validImageSizes = ["regular", "small", "thumb"];
    if (typeof imageSize !== "string" || !validImageSizes.includes(imageSize)) {
        throw new Error(
            `Invalid imageSize: must be one of ${validImageSizes.join(", ")}`
        );
    }

    const cacheKey = generateCacheKey(query, orientation);

    // Use the generic cache function from ServerStorageUtils
    const cacheData = await getCachedData<{
        query: string;
        orientation: string;
        images: CachedImageResult[];
    }>(
        "unsplashCache",
        cacheKey,
        async () => {
            const images = await fetchFromUnsplash(query, orientation);
            return { query, orientation, images };
        },
        12 * 30 * 24 * 60 * 60 * 1000 // 12 months
    );

    // Return requested limit with the specified URL size
    return cacheData.images.slice(0, limit).map((img) => ({
        url: img.urls[imageSize],
        description: img.description,
        width: img.width,
        height: img.height,
    }));
}
