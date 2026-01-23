import { describe, it, expect, vi, beforeEach } from "vitest";
import { getImages, generateCacheKey } from "./ServerImageUtils.js";
import { getCachedData } from "./ServerStorageUtils.js";

// Mock the getCachedData function
vi.mock("./ServerStorageUtils.js", () => ({
    getCachedData: vi.fn(),
}));

describe("getImages", () => {
    const mockGetCachedData = vi.mocked(getCachedData);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // Helper to create mock cached image data
    const createMockCachedImages = (count: number) => {
        return Array.from({ length: count }, (_, i) => ({
            urls: {
                regular: `https://example.com/regular-${i}.jpg`,
                small: `https://example.com/small-${i}.jpg`,
                thumb: `https://example.com/thumb-${i}.jpg`,
            },
            description: `Image ${i} description`,
            width: 1000 + i * 100,
            height: 800 + i * 50,
        }));
    };

    describe("Input Validation", () => {
        describe("query validation", () => {
            it("should throw error for empty string", async () => {
                await expect(
                    getImages("", 5, "landscape", "regular")
                ).rejects.toThrow("Invalid keyword: must be a non-empty string");
            });

            it("should throw error for whitespace-only string", async () => {
                await expect(
                    getImages("   ", 5, "landscape", "regular")
                ).rejects.toThrow("Invalid keyword: must be a non-empty string");
            });

            it("should throw error for string with only tabs and newlines", async () => {
                await expect(
                    getImages("\t\n\r", 5, "landscape", "regular")
                ).rejects.toThrow("Invalid keyword: must be a non-empty string");
            });

            it("should accept valid query string", async () => {
                const mockImages = createMockCachedImages(5);
                mockGetCachedData.mockResolvedValue({
                    query: "nature",
                    orientation: "landscape",
                    images: mockImages,
                });

                const result = await getImages("nature", 5, "landscape", "regular");
                expect(result).toHaveLength(5);
            });

            it("should accept query with special characters", async () => {
                const mockImages = createMockCachedImages(3);
                mockGetCachedData.mockResolvedValue({
                    query: "sunset & sunrise",
                    orientation: "landscape",
                    images: mockImages,
                });

                const result = await getImages("sunset & sunrise", 3, "landscape", "regular");
                expect(result).toHaveLength(3);
            });

            it("should accept query with URL-like strings", async () => {
                const mockImages = createMockCachedImages(2);
                mockGetCachedData.mockResolvedValue({
                    query: "https://example.com",
                    orientation: "portrait",
                    images: mockImages,
                });

                const result = await getImages("https://example.com", 2, "portrait", "small");
                expect(result).toHaveLength(2);
            });
        });

        describe("limit validation", () => {
            it("should throw error for limit less than 1", async () => {
                await expect(
                    getImages("test", 0, "landscape", "regular")
                ).rejects.toThrow("Invalid limit: must be an integer between 1 and 30");
            });

            it("should throw error for negative limit", async () => {
                await expect(
                    getImages("test", -1, "landscape", "regular")
                ).rejects.toThrow("Invalid limit: must be an integer between 1 and 30");
            });

            it("should throw error for limit greater than 30", async () => {
                await expect(
                    getImages("test", 31, "landscape", "regular")
                ).rejects.toThrow("Invalid limit: must be an integer between 1 and 30");
            });

            it("should throw error for decimal numbers", async () => {
                await expect(
                    getImages("test", 5.5, "landscape", "regular")
                ).rejects.toThrow("Invalid limit: must be an integer between 1 and 30");
            });

            it("should throw error for NaN", async () => {
                await expect(
                    getImages("test", NaN, "landscape", "regular")
                ).rejects.toThrow("Invalid limit: must be an integer between 1 and 30");
            });

            it("should throw error for Infinity", async () => {
                await expect(
                    getImages("test", Infinity, "landscape", "regular")
                ).rejects.toThrow("Invalid limit: must be an integer between 1 and 30");
            });

            it("should accept valid limit of 1", async () => {
                const mockImages = createMockCachedImages(1);
                mockGetCachedData.mockResolvedValue({
                    query: "test",
                    orientation: "landscape",
                    images: mockImages,
                });

                const result = await getImages("test", 1, "landscape", "regular");
                expect(result).toHaveLength(1);
            });

            it("should accept valid limit of 30", async () => {
                const mockImages = createMockCachedImages(30);
                mockGetCachedData.mockResolvedValue({
                    query: "test",
                    orientation: "landscape",
                    images: mockImages,
                });

                const result = await getImages("test", 30, "landscape", "regular");
                expect(result).toHaveLength(30);
            });

            it("should accept valid limit in the middle range", async () => {
                const mockImages = createMockCachedImages(15);
                mockGetCachedData.mockResolvedValue({
                    query: "test",
                    orientation: "landscape",
                    images: mockImages,
                });

                const result = await getImages("test", 15, "landscape", "regular");
                expect(result).toHaveLength(15);
            });
        });

        describe("orientation validation", () => {
            it("should throw error for invalid orientation", async () => {
                await expect(
                    getImages("test", 5, "invalid", "regular")
                ).rejects.toThrow("Invalid orientation: must be one of landscape, portrait, squarish");
            });

            it("should throw error for empty string orientation", async () => {
                await expect(
                    getImages("test", 5, "", "regular")
                ).rejects.toThrow("Invalid orientation: must be one of landscape, portrait, squarish");
            });

            it("should throw error for case-sensitive mismatch", async () => {
                await expect(
                    getImages("test", 5, "Landscape", "regular")
                ).rejects.toThrow("Invalid orientation: must be one of landscape, portrait, squarish");
            });

            it("should accept landscape orientation", async () => {
                const mockImages = createMockCachedImages(5);
                mockGetCachedData.mockResolvedValue({
                    query: "test",
                    orientation: "landscape",
                    images: mockImages,
                });

                const result = await getImages("test", 5, "landscape", "regular");
                expect(result).toHaveLength(5);
            });

            it("should accept portrait orientation", async () => {
                const mockImages = createMockCachedImages(5);
                mockGetCachedData.mockResolvedValue({
                    query: "test",
                    orientation: "portrait",
                    images: mockImages,
                });

                const result = await getImages("test", 5, "portrait", "regular");
                expect(result).toHaveLength(5);
            });

            it("should accept squarish orientation", async () => {
                const mockImages = createMockCachedImages(5);
                mockGetCachedData.mockResolvedValue({
                    query: "test",
                    orientation: "squarish",
                    images: mockImages,
                });

                const result = await getImages("test", 5, "squarish", "regular");
                expect(result).toHaveLength(5);
            });
        });

        describe("imageSize validation", () => {
            it("should throw error for invalid imageSize", async () => {
                await expect(
                    getImages("test", 5, "landscape", "invalid" as "regular" | "small" | "thumb")
                ).rejects.toThrow("Invalid imageSize: must be one of regular, small, thumb");
            });

            it("should throw error for empty string imageSize", async () => {
                await expect(
                    getImages("test", 5, "landscape", "" as "regular" | "small" | "thumb")
                ).rejects.toThrow("Invalid imageSize: must be one of regular, small, thumb");
            });

            it("should accept regular imageSize", async () => {
                const mockImages = createMockCachedImages(5);
                mockGetCachedData.mockResolvedValue({
                    query: "test",
                    orientation: "landscape",
                    images: mockImages,
                });

                const result = await getImages("test", 5, "landscape", "regular");
                expect(result[0].url).toBe("https://example.com/regular-0.jpg");
            });

            it("should accept small imageSize", async () => {
                const mockImages = createMockCachedImages(5);
                mockGetCachedData.mockResolvedValue({
                    query: "test",
                    orientation: "landscape",
                    images: mockImages,
                });

                const result = await getImages("test", 5, "landscape", "small");
                expect(result[0].url).toBe("https://example.com/small-0.jpg");
            });

            it("should accept thumb imageSize", async () => {
                const mockImages = createMockCachedImages(5);
                mockGetCachedData.mockResolvedValue({
                    query: "test",
                    orientation: "landscape",
                    images: mockImages,
                });

                const result = await getImages("test", 5, "landscape", "thumb");
                expect(result[0].url).toBe("https://example.com/thumb-0.jpg");
            });
        });
    });

    describe("Cache Behavior", () => {
        it("should call getCachedData with correct parameters on cache hit", async () => {
            const mockImages = createMockCachedImages(10);
            mockGetCachedData.mockResolvedValue({
                query: "nature",
                orientation: "landscape",
                images: mockImages,
            });

            await getImages("nature", 5, "landscape", "regular");

            expect(mockGetCachedData).toHaveBeenCalledWith(
                "unsplashCache",
                "nature|landscape",
                expect.any(Function),
                12 * 30 * 24 * 60 * 60 * 1000
            );
        });

        it("should use correct cache key for different query and orientation combinations", async () => {
            const mockImages = createMockCachedImages(5);
            mockGetCachedData.mockResolvedValue({
                query: "test",
                orientation: "portrait",
                images: mockImages,
            });

            await getImages("test", 5, "portrait", "regular");

            expect(mockGetCachedData).toHaveBeenCalledWith(
                "unsplashCache",
                "test|portrait",
                expect.any(Function),
                expect.any(Number)
            );
        });

        it("should call fetchFn when cache misses", async () => {
            let fetchFnCalled = false;
            const mockImages = createMockCachedImages(5);

            mockGetCachedData.mockImplementation(async (collection, key, fetchFn) => {
                fetchFnCalled = true;
                const result = await fetchFn();
                return result;
            });

            // Mock fetchFromUnsplash by mocking fetch
            const originalFetch = global.fetch;
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    total: 5,
                    total_pages: 1,
                    results: mockImages.map((img, i) => ({
                        id: `photo-${i}`,
                        width: img.width,
                        height: img.height,
                        description: img.description,
                        alt_description: null,
                        urls: {
                            raw: `https://example.com/raw-${i}.jpg`,
                            full: `https://example.com/full-${i}.jpg`,
                            regular: img.urls.regular,
                            small: img.urls.small,
                            thumb: img.urls.thumb,
                        },
                    })),
                }),
            } as Response);

            // Set environment variable for fetchFromUnsplash
            process.env.UNSPLASH_ACCESS_KEY = "test-key";

            try {
                await getImages("test", 5, "landscape", "regular");
                expect(fetchFnCalled).toBe(true);
            } finally {
                global.fetch = originalFetch;
                delete process.env.UNSPLASH_ACCESS_KEY;
            }
        });

        it("should generate correct cache keys for all orientations", async () => {
            const mockImages = createMockCachedImages(3);
            const orientations = ["landscape", "portrait", "squarish"] as const;

            for (const orientation of orientations) {
                mockGetCachedData.mockResolvedValueOnce({
                    query: "test",
                    orientation,
                    images: mockImages,
                });

                await getImages("test", 3, orientation, "regular");

                expect(mockGetCachedData).toHaveBeenCalledWith(
                    "unsplashCache",
                    `test|${orientation}`,
                    expect.any(Function),
                    expect.any(Number)
                );
            }
        });
    });

    describe("Data Transformation", () => {
        it("should slice images correctly when limit is less than available images", async () => {
            const mockImages = createMockCachedImages(30);
            mockGetCachedData.mockResolvedValue({
                query: "test",
                orientation: "landscape",
                images: mockImages,
            });

            const result = await getImages("test", 5, "landscape", "regular");
            expect(result).toHaveLength(5);
            expect(result[0].url).toBe("https://example.com/regular-0.jpg");
            expect(result[4].url).toBe("https://example.com/regular-4.jpg");
        });

        it("should return all images when limit equals available images", async () => {
            const mockImages = createMockCachedImages(30);
            mockGetCachedData.mockResolvedValue({
                query: "test",
                orientation: "landscape",
                images: mockImages,
            });

            const result = await getImages("test", 30, "landscape", "regular");
            expect(result).toHaveLength(30);
        });

        it("should return fewer images when limit is greater than available images", async () => {
            const mockImages = createMockCachedImages(10);
            mockGetCachedData.mockResolvedValue({
                query: "test",
                orientation: "landscape",
                images: mockImages,
            });

            const result = await getImages("test", 15, "landscape", "regular");
            expect(result).toHaveLength(10);
        });

        it("should select correct URL size for regular", async () => {
            const mockImages = createMockCachedImages(3);
            mockGetCachedData.mockResolvedValue({
                query: "test",
                orientation: "landscape",
                images: mockImages,
            });

            const result = await getImages("test", 3, "landscape", "regular");
            result.forEach((img, i) => {
                expect(img.url).toBe(`https://example.com/regular-${i}.jpg`);
            });
        });

        it("should select correct URL size for small", async () => {
            const mockImages = createMockCachedImages(3);
            mockGetCachedData.mockResolvedValue({
                query: "test",
                orientation: "landscape",
                images: mockImages,
            });

            const result = await getImages("test", 3, "landscape", "small");
            result.forEach((img, i) => {
                expect(img.url).toBe(`https://example.com/small-${i}.jpg`);
            });
        });

        it("should select correct URL size for thumb", async () => {
            const mockImages = createMockCachedImages(3);
            mockGetCachedData.mockResolvedValue({
                query: "test",
                orientation: "landscape",
                images: mockImages,
            });

            const result = await getImages("test", 3, "landscape", "thumb");
            result.forEach((img, i) => {
                expect(img.url).toBe(`https://example.com/thumb-${i}.jpg`);
            });
        });

        it("should preserve all image properties in result", async () => {
            const mockImages = createMockCachedImages(3);
            mockGetCachedData.mockResolvedValue({
                query: "test",
                orientation: "landscape",
                images: mockImages,
            });

            const result = await getImages("test", 3, "landscape", "regular");
            expect(result[0]).toEqual({
                url: "https://example.com/regular-0.jpg",
                description: "Image 0 description",
                width: 1000,
                height: 800,
            });
            expect(result[1]).toEqual({
                url: "https://example.com/regular-1.jpg",
                description: "Image 1 description",
                width: 1100,
                height: 850,
            });
        });

        it("should handle empty description in cached data", async () => {
            const mockImages = [
                {
                    urls: {
                        regular: "https://example.com/regular-0.jpg",
                        small: "https://example.com/small-0.jpg",
                        thumb: "https://example.com/thumb-0.jpg",
                    },
                    description: "",
                    width: 1000,
                    height: 800,
                },
            ];
            mockGetCachedData.mockResolvedValue({
                query: "test",
                orientation: "landscape",
                images: mockImages,
            });

            const result = await getImages("test", 1, "landscape", "regular");
            expect(result[0].description).toBe("");
        });
    });

    describe("Edge Cases", () => {
        it("should handle limit of 1 correctly", async () => {
            const mockImages = createMockCachedImages(30);
            mockGetCachedData.mockResolvedValue({
                query: "test",
                orientation: "landscape",
                images: mockImages,
            });

            const result = await getImages("test", 1, "landscape", "regular");
            expect(result).toHaveLength(1);
            expect(result[0].url).toBe("https://example.com/regular-0.jpg");
        });

        it("should handle limit of 30 correctly", async () => {
            const mockImages = createMockCachedImages(30);
            mockGetCachedData.mockResolvedValue({
                query: "test",
                orientation: "landscape",
                images: mockImages,
            });

            const result = await getImages("test", 30, "landscape", "regular");
            expect(result).toHaveLength(30);
            expect(result[29].url).toBe("https://example.com/regular-29.jpg");
        });

        it("should handle query with special characters in cache key", async () => {
            const mockImages = createMockCachedImages(5);
            mockGetCachedData.mockResolvedValue({
                query: "test|query",
                orientation: "landscape",
                images: mockImages,
            });

            await getImages("test|query", 5, "landscape", "regular");
            expect(mockGetCachedData).toHaveBeenCalledWith(
                "unsplashCache",
                "test|query|landscape",
                expect.any(Function),
                expect.any(Number)
            );
        });

        it("should handle query with unicode characters", async () => {
            const mockImages = createMockCachedImages(3);
            mockGetCachedData.mockResolvedValue({
                query: "café 🎨",
                orientation: "portrait",
                images: mockImages,
            });

            const result = await getImages("café 🎨", 3, "portrait", "small");
            expect(result).toHaveLength(3);
            expect(mockGetCachedData).toHaveBeenCalledWith(
                "unsplashCache",
                "café 🎨|portrait",
                expect.any(Function),
                expect.any(Number)
            );
        });

        it("should handle all three orientations with same query", async () => {
            const mockImages = createMockCachedImages(5);
            const orientations = ["landscape", "portrait", "squarish"] as const;

            for (const orientation of orientations) {
                mockGetCachedData.mockResolvedValueOnce({
                    query: "nature",
                    orientation,
                    images: mockImages,
                });

                const result = await getImages("nature", 5, orientation, "regular");
                expect(result).toHaveLength(5);
            }

            expect(mockGetCachedData).toHaveBeenCalledTimes(3);
        });

        it("should handle different image sizes with same cached data", async () => {
            const mockImages = createMockCachedImages(3);
            mockGetCachedData.mockResolvedValue({
                query: "test",
                orientation: "landscape",
                images: mockImages,
            });

            const sizes = ["regular", "small", "thumb"] as const;
            for (const size of sizes) {
                const result = await getImages("test", 3, "landscape", size);
                expect(result[0].url).toContain(size);
            }
        });

        it("should handle single image in cache with limit of 1", async () => {
            const mockImages = createMockCachedImages(1);
            mockGetCachedData.mockResolvedValue({
                query: "test",
                orientation: "landscape",
                images: mockImages,
            });

            const result = await getImages("test", 1, "landscape", "regular");
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                url: "https://example.com/regular-0.jpg",
                description: "Image 0 description",
                width: 1000,
                height: 800,
            });
        });
    });

    describe("generateCacheKey", () => {
        it("should generate correct cache key format", () => {
            expect(generateCacheKey("test", "landscape")).toBe("test|landscape");
        });

        it("should handle special characters in query", () => {
            expect(generateCacheKey("test|query", "landscape")).toBe("test|query|landscape");
        });

        it("should handle different orientations", () => {
            expect(generateCacheKey("test", "portrait")).toBe("test|portrait");
            expect(generateCacheKey("test", "squarish")).toBe("test|squarish");
        });
    });
});
