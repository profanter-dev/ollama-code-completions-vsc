import * as vscode from 'vscode';

const USERNAME_KEY = 'ollamaCodeCompletions.username';
const PASSWORD_KEY = 'ollamaCodeCompletions.password';

export interface BasicAuthCredentials {
    username: string;
    password: string;
}

export class Credentials {
    constructor(private readonly secrets: vscode.SecretStorage) {}

    async get(): Promise<BasicAuthCredentials | undefined> {
        const username = await this.secrets.get(USERNAME_KEY);
        const password = await this.secrets.get(PASSWORD_KEY);
        if (username === undefined || password === undefined) {
            return undefined;
        }
        return { username, password };
    }

    async set(creds: BasicAuthCredentials): Promise<void> {
        await this.secrets.store(USERNAME_KEY, creds.username);
        await this.secrets.store(PASSWORD_KEY, creds.password);
    }

    async clear(): Promise<void> {
        await this.secrets.delete(USERNAME_KEY);
        await this.secrets.delete(PASSWORD_KEY);
    }
}
