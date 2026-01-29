// Image size options
export type ImageSize = "regular" | "small" | "thumb";

// Our response image format
export interface ImageResult {
    url: string;
    description: string;
    width: number;
    height: number;
}

// API response format from pistachio-ai.com/searchImages
interface SearchImagesResponse {
    success: boolean;
    images: ImageResult[];
    count: number;
}

// Fetch images from pistachio-ai.com/searchImages endpoint
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

    // Build query parameters
    const params = new URLSearchParams({
        query,
        limit: limit.toString(),
        orientation,
        imageSize,
    });

    const url = `https://pistachio-ai.com/api/searchImages?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
        if (response.status === 429) {
            throw new Error("API rate limit exceeded");
        }
        throw new Error(`API error: ${response.status}`);
    }

    const data = (await response.json()) as SearchImagesResponse;

    if (!data.success || !data.images) {
        throw new Error("Invalid API response format");
    }

    // Return the images (already limited by the API)
    return data.images;
}
