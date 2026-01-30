import { z } from "zod";
import { logger } from "../utils/Logger.js";

/**
 * Result type for icon search operations
 */
export interface IconResult {
    collection: string;
    name: string;
    svg: string;
}

/**
 * Search for icons from Iconify API
 * @param collection - Collection prefix to search within (e.g., "mdi", "fa", "heroicons")
 * @param prefixQuery - Search query term for icon names
 * @returns Array of IconResult objects or an error object
 */
async function searchIcons(
    collection: string,
    prefixQuery: string
): Promise<IconResult[] | { error: string }> {
    try {
        // Fixed limit of 32 icons
        const searchLimit = 32;

        // Build Iconify API URL
        const params = new URLSearchParams({
            query: prefixQuery,
            limit: searchLimit.toString(),
            prefix: collection,
        });

        const response = await fetch(
            `https://api.iconify.design/search?${params.toString()}`
        );

        if (!response.ok) {
            throw new Error(`Iconify API error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as
            | { icons: string[] }
            | { icons: string }
            | { icons?: string[] | string };
        // Iconify API returns icons as an array of strings like "collection:name"
        // or as an object with icons array
        const iconStrings: string[] = Array.isArray(data.icons)
            ? data.icons
            : data.icons
                ? [data.icons]
                : [];

        // Parse icon strings into objects
        const iconList: Array<{ collection: string; name: string }> = iconStrings
            .map((iconStr: string) => {
                const [collectionPart, ...nameParts] = iconStr.split(":");
                const name = nameParts.join(":");
                return { collection: collectionPart, name };
            })
            .filter((icon) => icon.collection && icon.name);

        // Fetch and filter SVGs
        const iconResults = await Promise.all(
            iconList.map(async (icon) => {
                try {
                    const svgResponse = await fetch(
                        `https://api.iconify.design/${icon.collection}/${icon.name}.svg`
                    );
                    if (!svgResponse.ok) {
                        return null; // Exclude if fetch fails
                    }
                    const svgString = await svgResponse.text();
                    // Check if SVG contains CSS styles (style tags), <image>, or <feImage> tags
                    const hasStyleTag = /<style[\s>]/.test(svgString);
                    const hasImageTag = /<image[\s>]/.test(svgString);
                    const hasFeImageTag = /<feImage[\s>]/.test(svgString);
                    if (hasStyleTag || hasImageTag || hasFeImageTag) {
                        return null; // Exclude problematic SVGs
                    }
                    return {
                        collection: icon.collection,
                        name: icon.name,
                        svg: svgString,
                    };
                } catch {
                    return null; // Exclude on error
                }
            })
        );

        // Remove null values and return valid icons
        const validIcons = iconResults.filter(
            (icon): icon is IconResult => icon !== null
        );

        return validIcons;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error({
            error_message: errorMessage,
            stack: errorStack,
        }, "Icon search error");
        return {
            error: errorMessage,
        };
    }
}

/**
 * Tool for searching icon SVGs
 */
export const searchIconTool = {
    name: "search_icon",
    description: "Search for icon SVGs",
    inputSchema: z.object({
        collection: z
            .enum([
                "mdi",
                "fa",
                "heroicons",
                "carbon",
                "tabler",
                "lucide",
                "fe",
                "bi",
                "ph",
                "ri",
                "material-symbols",
                "octicon",
                "ion",
                "bx",
            ])
            .describe("Collection prefix to search within"),
        prefixQuery: z
            .string()
            .describe("Search query term for icon names"),
    }),
    handler: async (args: {
        collection:
        | "mdi"
        | "fa"
        | "heroicons"
        | "carbon"
        | "tabler"
        | "lucide"
        | "fe"
        | "bi"
        | "ph"
        | "ri"
        | "material-symbols"
        | "octicon"
        | "ion"
        | "bx";
        prefixQuery: string;
    }) => {
        const { collection, prefixQuery } = args;

        try {
            const icons = await searchIcons(collection, prefixQuery);
            return { output: JSON.stringify(icons), success: true };
        } catch (error) {
            return {
                output:
                    error instanceof Error ? error.message : "Failed",
                success: false,
            };
        }
    },
};
