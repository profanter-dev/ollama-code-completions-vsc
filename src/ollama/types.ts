// Shapes for the subset of the Ollama HTTP API we use.
// Reference: https://github.com/ollama/ollama/blob/main/docs/api.md

export interface GenerateRequest {
    model: string;
    prompt: string;
    suffix?: string;
    stream: false;
    options?: {
        num_predict?: number;
        temperature?: number;
        stop?: string[];
    };
}

export interface GenerateResponse {
    model: string;
    created_at: string;
    response: string;
    done: boolean;
    // Other diagnostic fields are present but unused.
}

export interface TagsResponse {
    models: Array<{
        name: string;
        modified_at: string;
        size: number;
    }>;
}

export interface CompletionRequest {
    prefix: string;
    suffix: string;
    filename?: string;
}

export interface CompletionResult {
    text: string;
    elapsedMs: number;
}
