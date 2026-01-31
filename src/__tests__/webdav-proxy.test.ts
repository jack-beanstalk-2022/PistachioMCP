import { describe, it, expect, beforeEach, vi } from "vitest";
import { validatePath } from "../webdav-proxy.js";
import { existsSync, statSync, type Stats } from "fs";
import { join, resolve, normalize } from "path";
import { homedir } from "os";

// Mock fs module
vi.mock("fs", () => ({
    existsSync: vi.fn(),
    statSync: vi.fn(),
}));

// Helper function to create a mock Stats object
function createMockStats(isDirectory: boolean): Stats {
    return {
        isDirectory: () => isDirectory,
    } as Stats;
}

describe("validatePath", () => {
    // Calculate PROJECTS_ROOT the same way as in webdav-proxy.ts
    const PROJECTS_ROOT = process.env.PROJECTS_ROOT
        ? resolve(process.env.PROJECTS_ROOT.replace("~", homedir()))
        : join(homedir(), "PistachioMCPProjects");

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("valid paths", () => {
        it("should validate a simple project path", () => {
            const projectId = "test-project";
            const projectPath = join(PROJECTS_ROOT, projectId);
            const filePath = join(projectPath, "file.txt");

            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockReturnValue(createMockStats(true));

            const result = validatePath(`/${projectId}/file.txt`);

            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe(normalize(filePath));
            expect(result.error).toBeUndefined();
            expect(existsSync).toHaveBeenCalledWith(projectPath);
        });

        it("should validate a nested file path", () => {
            const projectId = "my-project";
            const projectPath = join(PROJECTS_ROOT, projectId);
            const filePath = join(projectPath, "src", "main", "file.txt");

            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockReturnValue(createMockStats(true));

            const result = validatePath(`/${projectId}/src/main/file.txt`);

            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe(normalize(filePath));
        });

        it("should handle URL-encoded paths", () => {
            const projectId = "test-project";
            const projectPath = join(PROJECTS_ROOT, projectId);
            const filePath = join(projectPath, "file with spaces.txt");

            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockReturnValue(createMockStats(true));

            const result = validatePath(`/${projectId}/file%20with%20spaces.txt`);

            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe(normalize(filePath));
        });

        it("should validate path without leading slash", () => {
            const projectId = "test-project";
            const projectPath = join(PROJECTS_ROOT, projectId);
            const filePath = join(projectPath, "file.txt");

            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockReturnValue(createMockStats(true));

            const result = validatePath(`${projectId}/file.txt`);

            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe(normalize(filePath));
        });
    });

    describe("path traversal attacks", () => {
        it("should reject paths with double slashes", () => {
            const result = validatePath("/test-project//file.txt");

            expect(result.valid).toBe(false);
            expect(result.error).toBe("Path contains suspicious patterns");
        });

        it("should ensure resolved paths stay within projects root", () => {
            // The path resolution check ensures that even if URL normalization occurs,
            // the final resolved path must be within PROJECTS_ROOT
            const projectId = "test-project";
            const projectPath = join(PROJECTS_ROOT, projectId);
            const filePath = join(projectPath, "file.txt");

            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockReturnValue(createMockStats(true));

            const result = validatePath(`/${projectId}/file.txt`);

            // Verify the resolved path is within PROJECTS_ROOT
            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe(normalize(filePath));
            expect(result.resolvedPath?.startsWith(normalize(PROJECTS_ROOT))).toBe(true);
        });

        it("should handle normalized paths that stay within projects root", () => {
            // When URL normalizes /test-project/../other-project/file.txt to /other-project/file.txt,
            // it resolves to PROJECTS_ROOT/other-project/file.txt which is still within PROJECTS_ROOT
            // This is valid behavior - the path traversal protection ensures paths stay within the root
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockReturnValue(createMockStats(true));

            const result = validatePath("/test-project/../other-project/file.txt");

            // After URL normalization: /other-project/file.txt
            // Resolves to: PROJECTS_ROOT/other-project/file.txt (within PROJECTS_ROOT)
            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toContain("other-project");
            expect(result.resolvedPath?.startsWith(normalize(PROJECTS_ROOT))).toBe(true);
        });
    });

    describe("project directory validation", () => {
        it("should reject path when project directory does not exist", () => {
            const projectId = "non-existent-project";

            vi.mocked(existsSync).mockReturnValue(false);

            const result = validatePath(`/${projectId}/file.txt`);

            expect(result.valid).toBe(false);
            expect(result.error).toBe(`Project directory does not exist: ${projectId}`);
            expect(existsSync).toHaveBeenCalledWith(join(PROJECTS_ROOT, projectId));
        });

        it("should reject path when project path is not a directory", () => {
            const projectId = "file-not-dir";

            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockReturnValue(createMockStats(false));

            const result = validatePath(`/${projectId}/file.txt`);

            expect(result.valid).toBe(false);
            expect(result.error).toBe(`Project path is not a directory: ${projectId}`);
        });

        it("should reject path when project directory cannot be accessed", () => {
            const projectId = "inaccessible-project";

            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockImplementation(() => {
                throw new Error("Permission denied");
            });

            const result = validatePath(`/${projectId}/file.txt`);

            expect(result.valid).toBe(false);
            expect(result.error).toContain(`Cannot access project directory: ${projectId}`);
        });
    });

    describe("edge cases", () => {
        it("should handle empty path", () => {
            const result = validatePath("");

            // Empty path resolves to PROJECTS_ROOT, which has no segments
            // So it should pass the project directory check (no segments = no project ID check)
            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe(normalize(PROJECTS_ROOT));
        });

        it("should handle root path", () => {
            const result = validatePath("/");

            // Root path has no segments, so should pass project directory check
            // but resolved path should be PROJECTS_ROOT
            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe(normalize(PROJECTS_ROOT));
        });

        it("should handle path with only project ID", () => {
            const projectId = "test-project";
            const projectPath = join(PROJECTS_ROOT, projectId);

            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockReturnValue(createMockStats(true));

            const result = validatePath(`/${projectId}`);

            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe(normalize(projectPath));
        });

        it("should handle URL with protocol (extracts pathname)", () => {
            // URL constructor will extract just the pathname part
            const projectId = "test-project";
            const projectPath = join(PROJECTS_ROOT, projectId);
            const filePath = join(projectPath, "file.txt");

            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockReturnValue(createMockStats(true));

            // Even with a full URL, it should extract the pathname
            const result = validatePath(`http://localhost/${projectId}/file.txt`);

            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe(normalize(filePath));
        });

        it("should handle special characters in path (URL encoded)", () => {
            const projectId = "test-project";

            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockReturnValue(createMockStats(true));

            // URL encode special characters
            const result = validatePath(`/${projectId}/file@%23%24%25%5E%26.txt`);

            expect(result.valid).toBe(true);
            // After decoding, the path should match
            expect(result.resolvedPath).toContain("file@#$%^&.txt");
        });

        it("should handle paths with query parameters", () => {
            const projectId = "test-project";
            const projectPath = join(PROJECTS_ROOT, projectId);
            const filePath = join(projectPath, "file.txt");

            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockReturnValue(createMockStats(true));

            // Query parameters should be ignored (only pathname is used)
            const result = validatePath(`/${projectId}/file.txt?version=1`);

            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe(normalize(filePath));
        });
    });

    describe("path normalization", () => {
        it("should normalize paths correctly", () => {
            const projectId = "test-project";
            const projectPath = join(PROJECTS_ROOT, projectId);
            const filePath = join(projectPath, "a", "b", "c", "file.txt");

            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockReturnValue(createMockStats(true));

            const result = validatePath(`/${projectId}/a/b/c/file.txt`);

            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe(normalize(filePath));
        });

        it("should handle paths with multiple segments", () => {
            const projectId = "my-app";
            const projectPath = join(PROJECTS_ROOT, projectId);
            const filePath = join(projectPath, "src", "components", "ui", "button.tsx");

            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(statSync).mockReturnValue(createMockStats(true));

            const result = validatePath(`/${projectId}/src/components/ui/button.tsx`);

            expect(result.valid).toBe(true);
            expect(result.resolvedPath).toBe(normalize(filePath));
        });
    });
});
