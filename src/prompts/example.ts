import { z } from "zod";

/**
 * Example prompt template that demonstrates prompt functionality
 * This prompt generates a greeting message
 */
export const examplePrompt = {
    name: "greeting",
    description: "Generates a personalized greeting message",
    arguments: z.object({
        name: z.string().describe("The name of the person to greet"),
        language: z
            .enum(["en", "es", "fr", "de"])
            .optional()
            .describe("The language for the greeting (default: en)"),
    }),
    handler: (args: {
        name: string;
        language?: "en" | "es" | "fr" | "de";
    }) => {
        const { name, language = "en" } = args;

        const greetings: Record<string, string> = {
            en: `Hello, ${name}! Welcome to the MCP server.`,
            es: `¡Hola, ${name}! Bienvenido al servidor MCP.`,
            fr: `Bonjour, ${name}! Bienvenue sur le serveur MCP.`,
            de: `Hallo, ${name}! Willkommen beim MCP-Server.`,
        };

        return [
            {
                role: "user" as const,
                content: {
                    type: "text" as const,
                    text: greetings[language],
                },
            },
        ];
    },
};
