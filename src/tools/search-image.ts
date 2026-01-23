import { z } from "zod";
import { getImages } from "../utils/ServerImageUtils.js";

/**
 * Tool for searching image assets that can be used in the design
 */
export const searchImageTool = {
    name: "search_image",
    description: "Search for image assets that can be used in the design",
    inputSchema: z.object({
        keyword: z.string().describe("only support single keyword"),
        limit: z
            .number()
            .max(30)
            .describe("number of images to return, max 30"),
        orientation: z
            .enum(["landscape", "portrait", "squarish"])
            .describe("Image orientation"),
        imageSize: z
            .enum(["regular", "small", "thumb"])
            .describe("size of the image to return"),
    }),
    handler: async (args: {
        keyword: string;
        limit: number;
        orientation: "landscape" | "portrait" | "squarish";
        imageSize: "regular" | "small" | "thumb";
    }) => {
        const { keyword, limit, orientation, imageSize } = args;

        try {
            // Validation is handled by getImages function
            const images = await getImages(keyword, limit, orientation, imageSize);
            return { output: JSON.stringify(images), success: true };
        } catch (error) {
            return {
                output:
                    error instanceof Error ? error.message : "Failed",
                success: false,
            };
        }
    },
};
