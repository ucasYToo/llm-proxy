export declare function buildCommitPrompt(options: {
    diff: string;
    language: "zh" | "en";
    conventionalCommits: boolean;
    customPrompt?: string;
}): {
    system: string;
    user: string;
};
