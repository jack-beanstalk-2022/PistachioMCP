import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getImages } from "../../utils/ServerImageUtils.js";

describe("getImages", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    // Helper to create mock image data
    const createMockImages = (count: number) => {
        return Array.from({ length: count }, (_, i) => ({
            url: `https://example.com/image-${i}.jpg`,
            description: `Image ${i} description`,
            width: 1000 + i * 100,
            height: 800 + i * 50,
        }));
    };

    // Helper to mock fetch response
    const mockFetchResponse = (images: ReturnType<typeof createMockImages>) => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
                success: true,
                images,
                count: images.length,
            }),
        } as Response);
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
                const mockImages = createMockImages(5);
                mockFetchResponse(mockImages);

                const result = await getImages("nature", 5, "landscape", "regular");
                expect(result).toHaveLength(5);
            });

            it("should accept query with special characters", async () => {
                const mockImages = createMockImages(3);
                mockFetchResponse(mockImages);

                const result = await getImages("sunset & sunrise", 3, "landscape", "regular");
                expect(result).toHaveLength(3);
            });

            it("should accept query with URL-like strings", async () => {
                const mockImages = createMockImages(2);
                mockFetchResponse(mockImages);

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
                const mockImages = createMockImages(1);
                mockFetchResponse(mockImages);

                const result = await getImages("test", 1, "landscape", "regular");
                expect(result).toHaveLength(1);
            });

            it("should accept valid limit of 30", async () => {
                const mockImages = createMockImages(30);
                mockFetchResponse(mockImages);

                const result = await getImages("test", 30, "landscape", "regular");
                expect(result).toHaveLength(30);
            });

            it("should accept valid limit in the middle range", async () => {
                const mockImages = createMockImages(15);
                mockFetchResponse(mockImages);

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
                const mockImages = createMockImages(5);
                mockFetchResponse(mockImages);

                const result = await getImages("test", 5, "landscape", "regular");
                expect(result).toHaveLength(5);
            });

            it("should accept portrait orientation", async () => {
                const mockImages = createMockImages(5);
                mockFetchResponse(mockImages);

                const result = await getImages("test", 5, "portrait", "regular");
                expect(result).toHaveLength(5);
            });

            it("should accept squarish orientation", async () => {
                const mockImages = createMockImages(5);
                mockFetchResponse(mockImages);

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
                const mockImages = createMockImages(5);
                mockFetchResponse(mockImages);

                const result = await getImages("test", 5, "landscape", "regular");
                expect(result[0].url).toBe("https://example.com/image-0.jpg");
            });

            it("should accept small imageSize", async () => {
                const mockImages = createMockImages(5);
                mockFetchResponse(mockImages);

                const result = await getImages("test", 5, "landscape", "small");
                expect(result[0].url).toBe("https://example.com/image-0.jpg");
            });

            it("should accept thumb imageSize", async () => {
                const mockImages = createMockImages(5);
                mockFetchResponse(mockImages);

                const result = await getImages("test", 5, "landscape", "thumb");
                expect(result[0].url).toBe("https://example.com/image-0.jpg");
            });
        });
    });

    describe("API Integration", () => {
        it("should call pistachio-ai.com/searchImages with correct parameters", async () => {
            const mockImages = createMockImages(5);
            mockFetchResponse(mockImages);

            await getImages("nature", 5, "landscape", "regular");

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining("https://pistachio-ai.com/api/searchImages")
            );
            const mockFetch = vi.mocked(global.fetch);
            const callUrl = mockFetch.mock.calls[0]?.[0];
            if (!callUrl || typeof callUrl !== "string") {
                throw new Error("Expected fetch to be called with a string URL");
            }
            const url = new URL(callUrl);
            expect(url.searchParams.get("query")).toBe("nature");
            expect(url.searchParams.get("limit")).toBe("5");
            expect(url.searchParams.get("orientation")).toBe("landscape");
            expect(url.searchParams.get("imageSize")).toBe("regular");
        });

        it("should handle API errors", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 429,
            } as Response);

            await expect(
                getImages("test", 5, "landscape", "regular")
            ).rejects.toThrow("API rate limit exceeded");
        });

        it("should handle invalid API response format", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    success: false,
                }),
            } as Response);

            await expect(
                getImages("test", 5, "landscape", "regular")
            ).rejects.toThrow("Invalid API response format");
        });
    });

    describe("Data Transformation", () => {
        it("should return images from API response", async () => {
            const mockImages = createMockImages(5);
            mockFetchResponse(mockImages);

            const result = await getImages("test", 5, "landscape", "regular");
            expect(result).toHaveLength(5);
            expect(result[0].url).toBe("https://example.com/image-0.jpg");
            expect(result[4].url).toBe("https://example.com/image-4.jpg");
        });

        it("should return all images when limit equals available images", async () => {
            const mockImages = createMockImages(30);
            mockFetchResponse(mockImages);

            const result = await getImages("test", 30, "landscape", "regular");
            expect(result).toHaveLength(30);
        });

        it("should preserve all image properties in result", async () => {
            const mockImages = createMockImages(3);
            mockFetchResponse(mockImages);

            const result = await getImages("test", 3, "landscape", "regular");
            expect(result[0]).toEqual({
                url: "https://example.com/image-0.jpg",
                description: "Image 0 description",
                width: 1000,
                height: 800,
            });
            expect(result[1]).toEqual({
                url: "https://example.com/image-1.jpg",
                description: "Image 1 description",
                width: 1100,
                height: 850,
            });
        });

        it("should handle empty description", async () => {
            const mockImages = [
                {
                    url: "https://example.com/image-0.jpg",
                    description: "",
                    width: 1000,
                    height: 800,
                },
            ];
            mockFetchResponse(mockImages);

            const result = await getImages("test", 1, "landscape", "regular");
            expect(result[0].description).toBe("");
        });
    });

    describe("Edge Cases", () => {
        it("should handle limit of 1 correctly", async () => {
            const mockImages = createMockImages(1);
            mockFetchResponse(mockImages);

            const result = await getImages("test", 1, "landscape", "regular");
            expect(result).toHaveLength(1);
            expect(result[0].url).toBe("https://example.com/image-0.jpg");
        });

        it("should handle limit of 30 correctly", async () => {
            const mockImages = createMockImages(30);
            mockFetchResponse(mockImages);

            const result = await getImages("test", 30, "landscape", "regular");
            expect(result).toHaveLength(30);
            expect(result[29].url).toBe("https://example.com/image-29.jpg");
        });

        it("should handle query with special characters", async () => {
            const mockImages = createMockImages(5);
            mockFetchResponse(mockImages);

            const result = await getImages("test|query", 5, "landscape", "regular");
            expect(result).toHaveLength(5);
        });

        it("should handle query with unicode characters", async () => {
            const mockImages = createMockImages(3);
            mockFetchResponse(mockImages);

            const result = await getImages("café 🎨", 3, "portrait", "small");
            expect(result).toHaveLength(3);
        });

        it("should handle all three orientations with same query", async () => {
            const mockImages = createMockImages(5);
            const orientations = ["landscape", "portrait", "squarish"] as const;

            for (const orientation of orientations) {
                mockFetchResponse(mockImages);
                const result = await getImages("nature", 5, orientation, "regular");
                expect(result).toHaveLength(5);
            }
        });

        it("should handle different image sizes", async () => {
            const mockImages = createMockImages(3);
            const sizes = ["regular", "small", "thumb"] as const;

            for (const size of sizes) {
                mockFetchResponse(mockImages);
                const result = await getImages("test", 3, "landscape", size);
                expect(result).toHaveLength(3);
            }
        });
    });
});
