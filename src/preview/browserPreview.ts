import * as vscode from 'vscode';
export class BrowserPreview {
    constructor(private previewUrl: string) {}

    public async preview() {
        try {
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(this.previewUrl));
        } catch (e) {
            console.error(`get an error when opening Browser`);
            throw e;
        }
    }
}
