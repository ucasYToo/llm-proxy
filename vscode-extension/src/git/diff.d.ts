export interface DiffResult {
    diff: string;
    staged: boolean;
    truncated: boolean;
}
export declare function getGitDiff(cwd: string, maxLines: number): DiffResult;
