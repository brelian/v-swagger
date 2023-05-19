import SwaggerParser from '@apidevtools/swagger-parser';
import * as _ from 'lodash';
import { OpenAPI } from 'openapi-types';
import * as path from 'path';
import * as vscode from 'vscode';
import { VCache } from '../cache/vCache';
import { VServer } from '../server/vServer';
import { $RefSchema, FileNameHash, RewriteConfig } from '../types';
import { hashFileName, isInternal$Ref, isValid$Ref, normalize$Ref } from '../utils/fileUtil';
import { PathRewriter } from './pathRewriter';

export class VParser {
    private seen: Set<FileNameHash> = new Set();
    private readonly hash: FileNameHash;

    constructor(readonly rewriteConfig: RewriteConfig, readonly fileName: string) {
        this.registerFileChangeListener();
        this.hash = hashFileName(fileName);
    }

    public async parse(): Promise<vscode.Uri> {
        try {
            this.seen.clear();
            if (!VCache.has(this.hash) || !VCache.mustRevalidate(this.hash)) {
                await this.resolve(this.fileName);
                // todo: watch change & notify subscribers
            }
        } catch (e) {
            console.error(`[v-parser]: gets an error when parsing yaml: %o`, e);
        }
        return this.getPreviewUrl();
    }

    private async resolve(fileName: string) {
        const hash = hashFileName(fileName);
        // the freshness is maintained by File Watcher
        if (this.seen.has(hash) || (VCache.has(hash) && VCache.mustRevalidate(hash))) {
            return;
        }
        try {
            // mark as resolved in advance nevertheless there is an error
            this.seen.add(hash);
            let parsedSchema = await SwaggerParser.parse(fileName);

            const rewriter = new PathRewriter(this.rewriteConfig, fileName);
            parsedSchema = rewriter.rewrite(parsedSchema);
            for (const ref of rewriter.getAllRefs()) {
                await this.resolve(ref);
            }
            const dereferenced = await this.dereference(parsedSchema);
            VCache.set(hash, { schema: dereferenced, fileName, mustRevalidate: false });
        } catch (e) {
            console.error(`[v-parser]: gets an error when resolving %s: %o`, fileName, e);
        }
    }

    private async dereference(schema: OpenAPI.Document): Promise<OpenAPI.Document> {
        const dereferenced = await this.dereferenceInternal(schema);
        this.dereferenceExternal(dereferenced, new WeakSet());
        return dereferenced;
    }

    private async dereferenceInternal(schema: OpenAPI.Document): Promise<OpenAPI.Document> {
        try {
            return await SwaggerParser.dereference(schema, {
                resolve: {
                    external: false,
                },
                dereference: {
                    circular: 'ignore',
                },
            });
        } catch (e) {
            console.error(`[v-parser]: dereference internal reference failed due to %s`, e);
            throw e;
        }
    }

    private dereferenceExternal(schema: object, resolved: WeakSet<object>) {
        try {
            if (!_.isObject(schema) || resolved.has(schema)) {
                return schema;
            }
            resolved.add(schema);

            for (const [key, value] of Object.entries(schema)) {
                if (isValid$Ref(key, value) && !isInternal$Ref(key, value)) {
                    this.resolveExternal$Ref(schema, value);
                } else {
                    this.dereferenceExternal(value, resolved);
                }
            }
        } catch (e) {
            console.error(`[v-parser]: dereference external reference failed due to %s`, e);
        }
    }

    private resolveExternal$Ref(schema: $RefSchema, value: string) {
        const { absolutePath, hashPath } = normalize$Ref(value);
        const hash = hashFileName(absolutePath);
        if (!VCache.has(hash)) {
            return;
        }
        const { schema: refSchema } = VCache.get(hash)!;
        const refPath = hashPath.replaceAll(path.posix.sep, '.');
        const resolvedRef = _.get(refSchema, refPath);
        delete schema.$ref;
        _.assign(schema, resolvedRef);
    }

    private registerFileChangeListener() {
        console.info(`[v-parser]: create watcher for file - %s`, this.fileName);
        // for files not in opened workspace folders, must be specified in such a RelativePattern way
        // for files in opened workspace folders, this also works
        const fileNameInRelativeWay = new vscode.RelativePattern(
            vscode.Uri.file(path.dirname(this.fileName)),
            path.basename(this.fileName)
        );
        const watcher = vscode.workspace.createFileSystemWatcher(fileNameInRelativeWay);
        watcher.onDidChange(async (uri) => {
            await vscode.window.withProgress(
                {
                    title: `Synchronize changes of ${path.basename(this.fileName)} to preview client`,
                    location: vscode.ProgressLocation.Notification,
                },
                async () => {
                    VCache.setValidationState(this.hash, true);
                    console.info(`[v-parser]: file %s changed, notify clients`, uri);
                    // todo: decouple from VServer later
                    await VServer.getInstance().pushJsonSpec(this.hash);
                }
            );
        });
    }

    private getPreviewUrl(): vscode.Uri {
        const uri = vscode.Uri.joinPath(VServer.getInstance().getServerUri(), this.hash, path.basename(this.fileName));
        console.info(`[v-parser]: VServer serves page for %s at %s`, this.fileName, uri);
        return uri;
    }
}
