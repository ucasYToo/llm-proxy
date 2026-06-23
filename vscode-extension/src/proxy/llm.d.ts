interface GenerateOptions {
    system: string;
    userMessage: string;
    proxyBaseUrl: string;
}
export declare function generateWithLLM(options: GenerateOptions): Promise<string>;
export {};
